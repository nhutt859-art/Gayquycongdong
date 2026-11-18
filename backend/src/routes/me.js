import { Router } from 'express';
import { z } from 'zod';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { USER_PUBLIC_COLUMNS, KYC_COLUMNS, mapProject, mapKyc, mapUser } from '../lib/mappers.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { canonicalVietnamesePhone } from '../lib/phone.js';
import { notify } from '../services/notifications.js';
import { refreshRecommendations } from '../services/ai.js';
import { resendKycEmail, submitKyc } from '../services/kyc.js';

const router = Router();
router.use(requireAuth);

const updateSchema = z.object({
  full_name: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự.').max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  avatar_url: z.string().trim().max(500).nullable().optional(),
});

const kycSchema = z.object({
  full_name: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự.').max(120),
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh phải có dạng YYYY-MM-DD.'),
  phone: z.string().trim().min(8, 'Vui lòng nhập số điện thoại.').max(30),
  email: z.string().trim().email('Email liên hệ không hợp lệ.').max(160),
  address: z.string().trim().min(5, 'Vui lòng nhập địa chỉ thường trú.').max(300),
  document_type: z.enum(['cccd', 'passport'], { message: 'Chỉ chấp nhận CCCD hoặc hộ chiếu.' }),
  document_number: z.string().trim().min(5, 'Số giấy tờ tối thiểu 5 ký tự.').max(30),
  front_image: z.string().min(50, 'Vui lòng tải ảnh mặt trước giấy tờ.'),
  back_image: z.string().min(50).nullable().optional(),
});

const interestsSchema = z.object({
  category_ids: z.array(z.string().uuid('Danh mục không hợp lệ.')).max(20),
});

// GET /api/me
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const interests = await query(
      `select ui.category_id, c.name, ui.weight
         from user_interests ui join categories c on c.id = ui.category_id
        where ui.user_id = $1 order by ui.weight desc`,
      [req.user.id],
    );
    const stats = await query(
      `select
         (select count(*) from projects where owner_id = $1)::int as owned_projects,
         (select count(*) from project_collaborators where user_id = $1 and accepted_at is not null)::int as collaborating_projects,
         (select count(*) from notifications where user_id = $1 and not is_read)::int as unread_notifications,
         (select coalesce(sum(amount), 0) from pledges where backer_id = $1 and status = 'paid')::numeric as total_pledged`,
      [req.user.id],
    );
    const kyc = await query(`select ${KYC_COLUMNS} from users where id = $1`, [req.user.id]);
    res.json({
      user: req.user,
      kyc: mapKyc(kyc.rows[0]),
      interests: interests.rows.map((r) => ({ ...r, weight: Number(r.weight) })),
      stats: stats.rows[0],
    });
  }),
);

// PATCH /api/me
router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const body = parse(updateSchema, req.body);

    if (body.phone !== undefined) {
      if (body.phone === null || body.phone === '') {
        body.phone = null;
      } else {
        const phone = canonicalVietnamesePhone(body.phone);
        if (!phone) {
          throw new ApiError(400, 'Số điện thoại không hợp lệ. Dùng số di động Việt Nam 10 số (03/05/07/08/09) hoặc số cố định 11 số (02x).', {
            code: 'INVALID_PHONE',
            field: 'phone',
          });
        }
        body.phone = phone;
      }
    }

    const { rows } = await query(
      `update users
          set full_name = coalesce($1, full_name),
              phone = coalesce($2, phone),
              avatar_url = coalesce($3, avatar_url)
        where id = $4
        returning ${USER_PUBLIC_COLUMNS}`,
      [body.full_name ?? null, body.phone ?? null, body.avatar_url ?? null, req.user.id],
    );
    res.json({ user: mapUser(rows[0]) });
  }),
);

// POST /api/me/kyc — gửi hồ sơ CCCD/hộ chiếu và gửi email xác thực
router.post(
  '/kyc',
  rateLimit({ name: 'kyc-submit-user', max: 10, key: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const body = parse(kycSchema, req.body);
    const result = await submitKyc(req.user.id, body);
    res.json(result);
  }),
);

// POST /api/me/kyc/resend — gửi lại email xác thực hồ sơ KYC
router.post(
  '/kyc/resend',
  rateLimit({ name: 'kyc-resend-user', max: 5, key: (req) => req.user?.id }),
  asyncHandler(async (req, res) => {
    const result = await resendKycEmail(req.user.id);
    res.json(result);
  }),
);

// PUT /api/me/interests
router.put(
  '/interests',
  asyncHandler(async (req, res) => {
    const { category_ids } = parse(interestsSchema, req.body);
    const unique = [...new Set(category_ids)];

    if (unique.length) {
      const found = await query('select id from categories where id = any($1::uuid[])', [unique]);
      if (found.rowCount !== unique.length) throw new ApiError(400, 'Có danh mục không tồn tại.');
    }

    await withTransaction(async (client) => {
      await client.query('delete from user_interests where user_id = $1', [req.user.id]);
      for (const categoryId of unique) {
        await client.query(
          'insert into user_interests (user_id, category_id, weight) values ($1, $2, 0.8)',
          [req.user.id, categoryId],
        );
      }
    });

    const interests = await query(
      `select ui.category_id, c.name, ui.weight
         from user_interests ui join categories c on c.id = ui.category_id
        where ui.user_id = $1 order by ui.weight desc`,
      [req.user.id],
    );
    res.json({ interests: interests.rows.map((r) => ({ ...r, weight: Number(r.weight) })) });
  }),
);

// GET /api/me/projects — dự án sở hữu + cộng tác + lời mời
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const owned = await query(
      `select p.*, c.name as category_name,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count
         from projects p
         join categories c on c.id = p.category_id
        where p.owner_id = $1
        order by p.created_at desc`,
      [req.user.id],
    );

    const collaborating = await query(
      `select p.*, c.name as category_name, pc.role as collab_role, pc.accepted_at,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count
         from project_collaborators pc
         join projects p on p.id = pc.project_id
         join categories c on c.id = p.category_id
        where pc.user_id = $1 and pc.accepted_at is not null
        order by pc.accepted_at desc`,
      [req.user.id],
    );

    const invitations = await query(
      `select p.id, p.title, p.cover_emoji, p.cover_image_url, p.status, p.end_date,
              c.name as category_name, pc.role as collab_role, pc.invited_at,
              u.full_name as owner_name
         from project_collaborators pc
         join projects p on p.id = pc.project_id
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
        where pc.user_id = $1 and pc.accepted_at is null
        order by pc.invited_at desc`,
      [req.user.id],
    );

    res.json({
      owned: owned.rows.map(mapProject),
      collaborating: collaborating.rows.map(mapProject),
      invitations: invitations.rows,
    });
  }),
);

// POST /api/me/invitations/:projectId/accept
router.post(
  '/invitations/:projectId/accept',
  asyncHandler(async (req, res) => {
    const project = await query(
      `select p.title, p.owner_id, p.status
         from project_collaborators pc
         join projects p on p.id = pc.project_id
        where pc.project_id = $1 and pc.user_id = $2 and pc.accepted_at is null`,
      [req.params.projectId, req.user.id],
    );
    if (!project.rows[0]) throw new ApiError(404, 'Lời mời không tồn tại hoặc đã được xử lý.');
    if (project.rows[0].status === 'suspended') {
      throw new ApiError(409, 'Dự án đang tạm ngưng vì chủ dự án bị khóa tài khoản. Bạn chưa thể nhận lời mời cộng tác lúc này.', {
        code: 'PROJECT_SUSPENDED',
      });
    }

    const { rows } = await query(
      `update project_collaborators
          set accepted_at = now()
        where project_id = $1 and user_id = $2 and accepted_at is null
        returning project_id`,
      [req.params.projectId, req.user.id],
    );
    if (!rows.length) throw new ApiError(404, 'Lời mời không tồn tại hoặc đã được xử lý.');

    await notify(pool, project.rows[0].owner_id, {
      type: 'collab',
      content: `${req.user.full_name} đã chấp nhận lời mời cộng tác dự án “${project.rows[0].title}”.`,
      link: `/quan-ly/${req.params.projectId}`,
    });
    res.json({ message: 'Đã chấp nhận lời mời cộng tác.' });
  }),
);

// POST /api/me/invitations/:projectId/decline
router.post(
  '/invitations/:projectId/decline',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `delete from project_collaborators
        where project_id = $1 and user_id = $2 and accepted_at is null
        returning project_id`,
      [req.params.projectId, req.user.id],
    );
    if (!rows.length) throw new ApiError(404, 'Lời mời không tồn tại hoặc đã được xử lý.');
    res.json({ message: 'Đã từ chối lời mời.' });
  }),
);

// GET /api/me/pledges
router.get(
  '/pledges',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select pl.id, pl.amount, pl.is_anonymous, pl.status, pl.created_at,
              p.id as project_id, p.title as project_title, p.cover_emoji, p.cover_image_url,
              r.title as reward_title,
              t.id as transaction_id, t.status as transaction_status, t.method
         from pledges pl
         join projects p on p.id = pl.project_id
         left join rewards r on r.id = pl.reward_id
         left join lateral (
           select id, status, method from transactions
            where pledge_id = pl.id order by created_at desc limit 1
         ) t on true
        where pl.backer_id = $1
        order by pl.created_at desc`,
      [req.user.id],
    );
    res.json({ items: rows.map((r) => ({ ...r, amount: Number(r.amount) })) });
  }),
);

// GET /api/me/transactions
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const payments = await query(
      `select t.id, t.type, t.amount, t.method, t.gateway_ref, t.status, t.created_at,
              p.id as project_id, p.title as project_title
         from transactions t
         join pledges pl on pl.id = t.pledge_id
         join projects p on p.id = pl.project_id
        where pl.backer_id = $1`,
      [req.user.id],
    );
    const payouts = await query(
      `select t.id, t.type, t.amount, t.method, t.gateway_ref, t.status, t.created_at,
              p.id as project_id, p.title as project_title
         from transactions t
         join projects p on p.id = t.project_id
        where t.type = 'payout' and p.owner_id = $1`,
      [req.user.id],
    );
    const items = [...payments.rows, ...payouts.rows]
      .map((r) => ({ ...r, amount: Number(r.amount) }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ items });
  }),
);

// GET /api/me/notifications
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select id, type, content, link, is_read, created_at
         from notifications where user_id = $1
        order by created_at desc limit 100`,
      [req.user.id],
    );
    res.json({ items: rows, unread: rows.filter((r) => !r.is_read).length });
  }),
);

router.patch(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await query('update notifications set is_read = true where user_id = $1 and not is_read', [req.user.id]);
    res.json({ message: 'Đã đánh dấu tất cả là đã đọc.' });
  }),
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'update notifications set is_read = true where id = $1 and user_id = $2 returning id',
      [req.params.id, req.user.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy thông báo.');
    res.json({ message: 'Đã đọc.' });
  }),
);

router.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      'delete from notifications where id = $1 and user_id = $2 returning id',
      [req.params.id, req.user.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy thông báo.');
    res.status(204).end();
  }),
);

router.delete(
  '/notifications',
  asyncHandler(async (req, res) => {
    await query('delete from notifications where user_id = $1', [req.user.id]);
    res.status(204).end();
  }),
);

// GET /api/me/recommendations
router.get(
  '/recommendations',
  asyncHandler(async (req, res) => {
    const items = await refreshRecommendations(req.user.id);
    res.json({ items });
  }),
);

export default router;
