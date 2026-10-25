import { Router } from 'express';
import { z } from 'zod';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { mapProject, mapReward } from '../lib/mappers.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { assertCanManage, assertOwner, getProjectAccess } from '../services/permissions.js';
import { notify, notifyAdmins } from '../services/notifications.js';
import {
  fraudScoreForPledge,
  fraudScoreForProject,
  predictSuccess,
  savePrediction,
} from '../services/ai.js';

const router = Router();
const today = () => new Date().toISOString().slice(0, 10);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.');
const uuidSchema = z.string().uuid('ID không hợp lệ.');

const rewardSchema = z.object({
  title: z.string().trim().min(3, 'Tên gói tối thiểu 3 ký tự.').max(160),
  description: z.string().trim().max(1000).optional().nullable(),
  min_amount: z.coerce.number().int().positive('Mức tối thiểu phải lớn hơn 0.'),
  quantity_available: z.coerce.number().int().min(0).max(100000),
});

const createProjectSchema = z.object({
  title: z.string().trim().min(10, 'Tên chiến dịch tối thiểu 10 ký tự.').max(200),
  description: z.string().trim().min(30, 'Mô tả tối thiểu 30 ký tự.').max(5000),
  category_id: uuidSchema,
  goal_amount: z.coerce.number().int().min(100000, 'Mục tiêu tối thiểu 100.000đ.').max(100_000_000_000),
  start_date: dateSchema.optional(),
  end_date: dateSchema,
  cover_image_url: z.string().trim().max(500).optional().nullable(),
  cover_emoji: z.string().trim().max(8).optional().nullable(),
  rewards: z.array(rewardSchema).max(10).optional().default([]),
});

const updateProjectSchema = z.object({
  title: z.string().trim().min(10).max(200).optional(),
  description: z.string().trim().min(30).max(5000).optional(),
  category_id: uuidSchema.optional(),
  goal_amount: z.coerce.number().int().min(100000).max(100_000_000_000).optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  cover_image_url: z.string().trim().max(500).nullable().optional(),
  cover_emoji: z.string().trim().max(8).nullable().optional(),
});

const closeSchema = z.object({
  outcome: z.enum(['successful', 'failed', 'canceled'], { message: 'Trạng thái kết thúc không hợp lệ.' }),
});

const updatePostSchema = z.object({
  title: z.string().trim().min(3, 'Tiêu đề tối thiểu 3 ký tự.').max(180),
  content: z.string().trim().min(10, 'Nội dung tối thiểu 10 ký tự.').max(5000),
});

const commentSchema = z.object({
  content: z.string().trim().min(1, 'Nội dung bình luận không được để trống.').max(2000),
  parent_comment_id: z.string().uuid().nullable().optional(),
});

const reportSchema = z.object({
  reason: z.string().trim().min(10, 'Lý do tối thiểu 10 ký tự.').max(1000),
});

const pledgeSchema = z.object({
  amount: z.coerce.number().int().min(10000, 'Số tiền tối thiểu là 10.000đ.').max(10_000_000_000),
  reward_id: z.string().uuid().nullable().optional(),
  is_anonymous: z.boolean().optional().default(false),
  method: z.enum(['VNPay', 'Momo', 'Thẻ quốc tế']).optional().default('VNPay'),
  simulate_failure: z.boolean().optional().default(false),
});

const collaboratorSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ.'),
  role: z.enum(['editor', 'moderator']).optional().default('editor'),
});

const rewardPatchSchema = rewardSchema.partial();

const payoutSchema = z.object({
  amount: z.coerce.number().int().min(100000, 'Số tiền giải ngân tối thiểu 100.000đ.').max(100_000_000_000),
  note: z.string().trim().max(500).optional().nullable(),
});

async function notifyAudience(db, projectId, { type = 'update', content, link, excludeUserId = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link)
     select distinct x.user_id, $2, $3, $4
       from (
         select user_id from follows where project_id = $1
         union
         select backer_id from pledges where project_id = $1 and status = 'paid'
         union
         select user_id from project_collaborators where project_id = $1 and accepted_at is not null
       ) x
      where ($5::uuid is null or x.user_id <> $5)`,
    [projectId, type, content, link, excludeUserId],
  );
}

// ============================================================
// GET /api/projects — danh sách + lọc + phân trang
// ============================================================
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [];

    const isAdmin = req.user?.role === 'admin';
    const status = String(req.query.status || '').trim();
    const category = String(req.query.category || '').trim();
    const q = String(req.query.q || '').trim();
    const sort = String(req.query.sort || 'newest');

    if (status) {
      if (['draft', 'pending_review'].includes(status) && !isAdmin) {
        throw new ApiError(403, 'Bạn không có quyền xem dự án ở trạng thái này.');
      }
      where.push(`p.status = ${add(status)}`);
    } else if (!isAdmin) {
      where.push(`p.status not in ('draft', 'pending_review')`);
    }

    if (category) where.push(`p.category_id = ${add(category)}`);
    if (q) {
      const p = add(`%${q}%`);
      where.push(`(p.title ilike ${p} or p.description ilike ${p})`);
    }

    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 6));

    const countResult = await query(`select count(*)::int as total from projects p ${whereSql}`, params);
    const total = countResult.rows[0].total;

    let followSql = 'false as is_following';
    if (req.user) {
      followSql = `exists(select 1 from follows f where f.project_id = p.id and f.user_id = ${add(req.user.id)}) as is_following`;
    }

    const sortMap = {
      newest: 'p.created_at desc',
      ending: 'p.end_date asc',
      progress: '(p.current_amount::numeric / p.goal_amount) desc',
      ai: 'p.ai_success_score desc',
      popular: 'backer_count desc',
    };
    const orderBy = sortMap[sort] || sortMap.newest;

    const limitParam = add(limit);
    const offsetParam = add((page - 1) * limit);

    const { rows } = await query(
      `select p.*, c.name as category_name, u.full_name as owner_name,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count,
              ${followSql}
         from projects p
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
         ${whereSql}
        order by ${orderBy}
        limit ${limitParam} offset ${offsetParam}`,
      params,
    );

    let collabIds = new Set();
    if (req.user) {
      const collab = await query(
        'select project_id from project_collaborators where user_id = $1 and accepted_at is not null',
        [req.user.id],
      );
      collabIds = new Set(collab.rows.map((r) => r.project_id));
    }

    const items = rows.map((row) => {
      const role = req.user
        ? row.owner_id === req.user.id
          ? 'owner'
          : collabIds.has(row.id)
            ? 'collaborator'
            : null
        : null;
      return {
        ...mapProject(row),
        my_role: role,
        can_manage: role === 'owner' || role === 'collaborator',
        can_pledge:
          !!req.user &&
          row.status === 'active' &&
          row.owner_id !== req.user.id &&
          req.user.role !== 'admin' &&
          row.end_date >= today(),
      };
    });

    res.json({
      items,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
    });
  }),
);

// ============================================================
// GET /api/projects/:id — chi tiết đầy đủ cho trang Detail/Manage
// ============================================================
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const access = await getProjectAccess(pool, req.params.id, req.user);
    if (!access) throw new ApiError(404, 'Không tìm thấy dự án.');

    const projectResult = await query(
      `select p.*, c.name as category_name,
              u.full_name as owner_name, u.avatar_url as owner_avatar, u.trust_score as owner_trust_score
         from projects p
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
        where p.id = $1`,
      [req.params.id],
    );
    const project = projectResult.rows[0];

    const canSeeHidden = access.canManage || access.isAdmin;
    if (['draft', 'pending_review'].includes(project.status) && !canSeeHidden) {
      throw new ApiError(404, 'Không tìm thấy dự án.');
    }

    const [rewards, updates, comments, collaborators, followers, backers, pledgesSum, prediction, payouts] = await Promise.all([
      query('select * from rewards where project_id = $1 order by min_amount asc', [req.params.id]),
      query(
        `select pu.*, u.full_name as author_name
           from project_updates pu left join users u on u.id = pu.author_id
          where pu.project_id = $1 order by pu.created_at desc`,
        [req.params.id],
      ),
      query(
        `select c.*, u.full_name as user_name, u.avatar_url as user_avatar
           from comments c join users u on u.id = c.user_id
          where c.project_id = $1 order by c.created_at asc`,
        [req.params.id],
      ),
      query(
        `select pc.user_id, pc.role, pc.invited_at, pc.accepted_at, u.full_name, u.email, u.avatar_url
           from project_collaborators pc join users u on u.id = pc.user_id
          where pc.project_id = $1 ${canSeeHidden ? '' : 'and pc.accepted_at is not null'}
          order by pc.accepted_at nulls last, pc.invited_at`,
        [req.params.id],
      ),
      query('select count(*)::int as total from follows where project_id = $1', [req.params.id]),
      query(`select count(*)::int as total from pledges where project_id = $1 and status = 'paid'`, [req.params.id]),
      query(
        `select coalesce(sum(amount), 0)::numeric as total
           from pledges where project_id = $1 and status = 'paid'`,
        [req.params.id],
      ),
      query(
        `select * from ai_predictions where project_id = $1 order by predicted_at desc limit 1`,
        [req.params.id],
      ),
      query(
        `select t.id, t.amount, t.status, t.method, t.gateway_ref, t.created_at
           from transactions t
          where t.project_id = $1 and t.type = 'payout'
          order by t.created_at desc`,
        [req.params.id],
      ),
    ]);

    let isFollowing = false;
    let myPledgeTotal = 0;
    if (req.user) {
      const f = await query('select 1 from follows where user_id = $1 and project_id = $2', [req.user.id, req.params.id]);
      isFollowing = f.rowCount > 0;
      const mp = await query(
        `select coalesce(sum(amount), 0)::numeric as total from pledges
          where project_id = $1 and backer_id = $2 and status = 'paid'`,
        [req.params.id, req.user.id],
      );
      myPledgeTotal = Number(mp.rows[0].total);
    }

    const payoutTotal = payouts.rows
      .filter((t) => ['pending', 'success'].includes(t.status))
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const myRole = access.isOwner ? 'owner' : access.isCollaborator ? 'collaborator' : null;
    const canPledge =
      !!req.user &&
      project.status === 'active' &&
      project.owner_id !== req.user.id &&
      req.user.role !== 'admin' &&
      project.end_date >= today();

    res.json({
      ...mapProject({
        ...project,
        is_following: isFollowing,
        my_role: myRole,
        can_manage: access.canManage,
        can_pledge: canPledge,
      }),
      rewards: rewards.rows.map(mapReward),
      updates: updates.rows,
      comments: comments.rows,
      collaborators: collaborators.rows,
      follower_count: followers.rows[0].total,
      backer_count: backers.rows[0].total,
      raised_from_pledges: Number(pledgesSum.rows[0].total),
      my_pledge_total: myPledgeTotal,
      prediction: prediction.rows[0] || null,
      payouts: access.canManage || access.isAdmin ? payouts.rows.map((p) => ({ ...p, amount: Number(p.amount) })) : [],
      available_for_payout: access.canManage || access.isAdmin
        ? Math.max(0, Number(project.current_amount) - payoutTotal)
        : 0,
    });
  }),
);

// ============================================================
// GET /api/projects/:id/pledges — chủ dự án/cộng tác viên xem nhà tài trợ
// ============================================================
router.get(
  '/:id/pledges',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const { rows } = await query(
      `select pl.id, pl.amount, pl.is_anonymous, pl.status, pl.created_at,
              case when pl.is_anonymous then 'Nhà tài trợ ẩn danh' else u.full_name end as backer_name,
              case when pl.is_anonymous then null else u.email end as backer_email,
              r.title as reward_title
         from pledges pl
         join users u on u.id = pl.backer_id
         left join rewards r on r.id = pl.reward_id
        where pl.project_id = $1
        order by pl.created_at desc`,
      [req.params.id],
    );
    res.json({ items: rows.map((r) => ({ ...r, amount: Number(r.amount) })) });
  }),
);

// ============================================================
// POST /api/projects — tạo dự án (chờ duyệt)
// ============================================================
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role === 'admin') throw new ApiError(403, 'Quản trị viên không tạo dự án bằng tài khoản admin.');
    if (req.user.kyc_status !== 'verified') {
      throw new ApiError(403, 'Bạn cần xác thực danh tính (KYC) trước khi tạo dự án.');
    }

    const body = parse(createProjectSchema, req.body);
    const category = await query('select id, name from categories where id = $1', [body.category_id]);
    if (!category.rowCount) throw new ApiError(400, 'Danh mục không tồn tại.');

    const start = body.start_date || today();
    if (body.end_date <= start) throw new ApiError(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
    if (body.end_date < today()) throw new ApiError(400, 'Ngày kết thúc phải ở tương lai.');

    const durationDays = Math.max(1, Math.ceil((Date.parse(body.end_date) - Date.parse(start)) / 86_400_000));
    const aiScore = predictSuccess({
      goalAmount: body.goal_amount,
      categoryName: category.rows[0].name,
      rewardsCount: body.rewards.length,
      description: body.description,
      durationDays,
    });
    const fraudScore = fraudScoreForProject({
      goalAmount: body.goal_amount,
      trustScore: req.user.trust_score,
      kycStatus: req.user.kyc_status,
      description: body.description,
    });

    const project = await withTransaction(async (client) => {
      const inserted = await client.query(
        `insert into projects
          (owner_id, category_id, title, description, cover_image_url, cover_emoji,
           goal_amount, start_date, end_date, status, ai_success_score, fraud_risk_score)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_review', $10, $11)
         returning *`,
        [
          req.user.id, body.category_id, body.title, body.description,
          body.cover_image_url || null, body.cover_emoji || '🌱',
          body.goal_amount, start, body.end_date, aiScore, fraudScore,
        ],
      );
      const row = inserted.rows[0];

      for (const reward of body.rewards) {
        await client.query(
          `insert into rewards (project_id, title, description, min_amount, quantity_available)
           values ($1, $2, $3, $4, $5)`,
          [row.id, reward.title, reward.description || null, reward.min_amount, reward.quantity_available],
        );
      }

      await savePrediction(client, row.id, aiScore, {
        category: category.rows[0].name,
        goal: body.goal_amount,
        rewards: body.rewards.length,
        duration_days: durationDays,
      });

      await client.query(`update users set role = 'owner' where id = $1 and role = 'backer'`, [req.user.id]);

      await notifyAdmins(client, {
        type: 'project',
        content: `Dự án “${row.title}” đang chờ duyệt.`,
        link: '/admin/duyet-du-an',
      });

      return row;
    });

    res.status(201).json({
      project: mapProject({ ...project, category_name: category.rows[0].name, owner_name: req.user.full_name }),
      message: 'Đã gửi dự án, chờ admin duyệt.',
    });
  }),
);

// ============================================================
// PATCH /api/projects/:id — chủ dự án hoặc cộng tác viên
// ============================================================
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await assertCanManage(pool, req.params.id, req.user);
    const body = parse(updateProjectSchema, req.body);

    const hidden = ['category_id', 'goal_amount', 'start_date', 'end_date'];
    if (!access.canEditCore && hidden.some((key) => body[key] !== undefined)) {
      throw new ApiError(403, 'Cộng tác viên không được đổi danh mục, mục tiêu hoặc thời gian chiến dịch.');
    }

    const current = await query(
      `select p.*, c.name as category_name from projects p
        join categories c on c.id = p.category_id where p.id = $1`,
      [req.params.id],
    );
    const project = current.rows[0];

    const start = body.start_date ?? project.start_date;
    const end = body.end_date ?? project.end_date;
    if (end <= start) throw new ApiError(400, 'Ngày kết thúc phải sau ngày bắt đầu.');

    let categoryName = project.category_name;
    if (body.category_id) {
      const cat = await query('select name from categories where id = $1', [body.category_id]);
      if (!cat.rowCount) throw new ApiError(400, 'Danh mục không tồn tại.');
      categoryName = cat.rows[0].name;
    }

    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets = [];
    for (const key of ['title', 'description', 'category_id', 'goal_amount', 'start_date', 'end_date', 'cover_image_url', 'cover_emoji']) {
      if (body[key] !== undefined) sets.push(`${key} = ${add(body[key])}`);
    }
    if (!sets.length) throw new ApiError(400, 'Không có trường nào cần cập nhật.');

    if (sets.length) {
      const durationDays = Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / 86_400_000));
      const rewardsCount = await query('select count(*)::int as total from rewards where project_id = $1', [req.params.id]);
      const aiScore = predictSuccess({
        goalAmount: Number(body.goal_amount ?? project.goal_amount),
        categoryName,
        rewardsCount: rewardsCount.rows[0].total,
        description: body.description ?? project.description,
        durationDays,
      });
      const fraudScore = fraudScoreForProject({
        goalAmount: Number(body.goal_amount ?? project.goal_amount),
        trustScore: req.user.trust_score,
        kycStatus: req.user.kyc_status,
        description: body.description ?? project.description,
      });
      sets.push(`ai_success_score = ${add(aiScore)}`);
      sets.push(`fraud_risk_score = ${add(fraudScore)}`);
    }

    const idParam = add(req.params.id);
    const { rows } = await query(
      `update projects set ${sets.join(', ')} where id = ${idParam} returning *`,
      params,
    );

    if (body.goal_amount !== undefined || body.description !== undefined || body.end_date !== undefined) {
      await savePrediction(pool, rows[0].id, Number(rows[0].ai_success_score), {
        category: categoryName,
        goal: Number(rows[0].goal_amount),
        rewards: 0,
        updated: true,
      });
    }

    res.json({ project: mapProject({ ...rows[0], category_name: categoryName }) });
  }),
);

// ============================================================
// POST /api/projects/:id/close
// ============================================================
router.post(
  '/:id/close',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await assertOwner(pool, req.params.id, req.user);
    const { outcome } = parse(closeSchema, req.body);

    const { rows } = await query(
      'update projects set status = $1 where id = $2 returning *',
      [outcome, req.params.id],
    );
    const project = rows[0];

    const labels = { successful: 'thành công', failed: 'thất bại', canceled: 'đã dừng' };
    await notifyAudience(pool, project.id, {
      type: 'project',
      content: `Chiến dịch “${project.title}” đã kết thúc với trạng thái ${labels[outcome]}.`,
      link: `/du-an/${project.id}`,
      excludeUserId: req.user.id,
    });

    if (access.isAdmin) {
      await notify(pool, project.owner_id, {
        type: 'project',
        content: `Admin đã cập nhật trạng thái dự án “${project.title}” thành ${labels[outcome]}.`,
        link: `/quan-ly/${project.id}`,
      });
    }

    res.json({ project: mapProject(project), message: `Đã cập nhật trạng thái: ${labels[outcome]}.` });
  }),
);

// ============================================================
// POST /api/projects/:id/updates
// ============================================================
router.post(
  '/:id/updates',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const body = parse(updatePostSchema, req.body);

    const { rows } = await query(
      `insert into project_updates (project_id, author_id, title, content)
       values ($1, $2, $3, $4) returning *`,
      [req.params.id, req.user.id, body.title, body.content],
    );

    const project = await query('select title from projects where id = $1', [req.params.id]);
    await notifyAudience(pool, req.params.id, {
      type: 'update',
      content: `Dự án “${project.rows[0].title}” vừa có bản tin mới: ${body.title}.`,
      link: `/du-an/${req.params.id}`,
      excludeUserId: req.user.id,
    });

    res.status(201).json({ update: { ...rows[0], author_name: req.user.full_name } });
  }),
);

// ============================================================
// POST /api/projects/:id/comments
// ============================================================
router.post(
  '/:id/comments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(commentSchema, req.body);
    const project = await query('select id, title, owner_id from projects where id = $1', [req.params.id]);
    if (!project.rowCount) throw new ApiError(404, 'Không tìm thấy dự án.');

    let parent = null;
    if (body.parent_comment_id) {
      const p = await query('select id, user_id from comments where id = $1 and project_id = $2', [
        body.parent_comment_id,
        req.params.id,
      ]);
      if (!p.rowCount) throw new ApiError(400, 'Bình luận được trả lời không hợp lệ.');
      parent = p.rows[0];
    }

    const { rows } = await query(
      `insert into comments (project_id, user_id, parent_comment_id, content)
       values ($1, $2, $3, $4) returning *`,
      [req.params.id, req.user.id, body.parent_comment_id || null, body.content],
    );

    const link = `/du-an/${req.params.id}`;
    if (project.rows[0].owner_id !== req.user.id) {
      await notify(pool, project.rows[0].owner_id, {
        type: 'comment',
        content: `${req.user.full_name} vừa bình luận trong dự án “${project.rows[0].title}”.`,
        link,
      });
    }
    if (parent && parent.user_id !== req.user.id) {
      await notify(pool, parent.user_id, {
        type: 'comment',
        content: `${req.user.full_name} đã trả lời bình luận của bạn trong dự án “${project.rows[0].title}”.`,
        link,
      });
    }

    res.status(201).json({
      comment: { ...rows[0], user_name: req.user.full_name, user_avatar: req.user.avatar_url },
    });
  }),
);

// ============================================================
// FOLLOW / UNFOLLOW
// ============================================================
router.post(
  '/:id/follow',
  requireAuth,
  asyncHandler(async (req, res) => {
    const project = await query('select id, status from projects where id = $1', [req.params.id]);
    if (!project.rowCount) throw new ApiError(404, 'Không tìm thấy dự án.');
    await query(
      `insert into follows (user_id, project_id) values ($1, $2)
       on conflict (user_id, project_id) do nothing`,
      [req.user.id, req.params.id],
    );
    res.json({ following: true, message: 'Đã theo dõi dự án.' });
  }),
);

router.delete(
  '/:id/follow',
  requireAuth,
  asyncHandler(async (req, res) => {
    await query('delete from follows where user_id = $1 and project_id = $2', [req.user.id, req.params.id]);
    res.json({ following: false, message: 'Đã bỏ theo dõi dự án.' });
  }),
);

// ============================================================
// REPORT
// ============================================================
router.post(
  '/:id/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(reportSchema, req.body);
    const project = await query('select id, title, owner_id from projects where id = $1', [req.params.id]);
    if (!project.rowCount) throw new ApiError(404, 'Không tìm thấy dự án.');
    if (project.rows[0].owner_id === req.user.id) throw new ApiError(400, 'Bạn không thể báo cáo dự án của mình.');

    const existed = await query(
      `select 1 from reports where project_id = $1 and reporter_id = $2 and status = 'open'`,
      [req.params.id, req.user.id],
    );
    if (existed.rowCount) throw new ApiError(409, 'Bạn đã báo cáo dự án này và đang chờ xử lý.');

    const { rows } = await query(
      `insert into reports (project_id, reporter_id, reason) values ($1, $2, $3) returning *`,
      [req.params.id, req.user.id, body.reason],
    );

    await notifyAdmins(pool, {
      type: 'report',
      content: `Báo cáo mới cho dự án “${project.rows[0].title}” từ ${req.user.full_name}.`,
      link: '/admin/gian-lan',
    });

    res.status(201).json({ report: rows[0], message: 'Đã gửi báo cáo, admin sẽ xem xét sớm.' });
  }),
);

// ============================================================
// POST /api/projects/:id/pledges — tài trợ
// ============================================================
router.post(
  '/:id/pledges',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parse(pledgeSchema, req.body);
    if (req.user.role === 'admin') throw new ApiError(403, 'Quản trị viên không thực hiện tài trợ.');

    const result = await withTransaction(async (client) => {
      const projectResult = await client.query('select * from projects where id = $1 for update', [req.params.id]);
      if (!projectResult.rowCount) throw new ApiError(404, 'Không tìm thấy dự án.');
      const project = projectResult.rows[0];

      if (project.owner_id === req.user.id) throw new ApiError(400, 'Bạn không thể tài trợ chính dự án của mình.');
      if (project.status !== 'active') throw new ApiError(400, 'Dự án không ở trạng thái đang gây quỹ.');
      if (project.end_date < today()) throw new ApiError(400, 'Chiến dịch đã hết hạn.');

      let reward = null;
      if (body.reward_id) {
        const rewardResult = await client.query(
          'select * from rewards where id = $1 and project_id = $2 for update',
          [body.reward_id, req.params.id],
        );
        if (!rewardResult.rowCount) throw new ApiError(400, 'Gói tài trợ không hợp lệ.');
        reward = rewardResult.rows[0];
        if (body.amount < Number(reward.min_amount)) {
          throw new ApiError(400, `Gói “${reward.title}” yêu cầu tối thiểu ${Number(reward.min_amount).toLocaleString('vi-VN')}đ.`);
        }
        if (Number(reward.quantity_available) - Number(reward.quantity_claimed) <= 0) {
          throw new ApiError(400, 'Gói tài trợ đã hết suất.');
        }
      }

      if (body.simulate_failure) {
        throw new ApiError(402, 'Thanh toán thất bại (giả lập). Chưa tạo khoản tài trợ.');
      }

      const recent = await client.query(
        `select count(*)::int as total from pledges
          where backer_id = $1 and created_at > now() - interval '5 minutes'`,
        [req.user.id],
      );
      const risk = fraudScoreForPledge({
        amount: body.amount,
        isAnonymous: body.is_anonymous,
        trustScore: req.user.trust_score,
        recentCount: recent.rows[0].total + 1,
      });

      const gatewayRef = `${body.method.replace(/\s+/g, '').toUpperCase()}-${Date.now()}`;
      const pledgeResult = await client.query(
        `insert into pledges (project_id, backer_id, reward_id, amount, is_anonymous, status)
         values ($1, $2, $3, $4, $5, 'paid') returning *`,
        [req.params.id, req.user.id, body.reward_id || null, body.amount, body.is_anonymous],
      );
      const pledge = pledgeResult.rows[0];

      await client.query(
        `insert into transactions (pledge_id, project_id, type, amount, method, gateway_ref, status)
         values ($1, $2, 'payment', $3, $4, $5, 'success')`,
        [pledge.id, req.params.id, body.amount, body.method, gatewayRef],
      );

      if (risk >= 70) {
        await client.query(
          `insert into fraud_flags (entity_type, entity_id, risk_score, reason)
           values ('pledge', $1, $2, $3)`,
          [pledge.id, risk, `Giao dịch ${Number(body.amount).toLocaleString('vi-VN')}đ có dấu hiệu bất thường (${recent.rows[0].total + 1} giao dịch/5 phút).`],
        );
        await notifyAdmins(client, {
          type: 'fraud',
          content: `AI gắn cờ giao dịch ${Number(body.amount).toLocaleString('vi-VN')}đ của ${req.user.full_name}.`,
          link: '/admin/gian-lan',
        });
      }

      await notify(client, project.owner_id, {
        type: 'pledge',
        content: `${body.is_anonymous ? 'Một nhà tài trợ ẩn danh' : req.user.full_name} vừa tài trợ ${Number(body.amount).toLocaleString('vi-VN')}đ cho “${project.title}”.`,
        link: `/du-an/${project.id}`,
      });

      const updated = await client.query('select * from projects where id = $1', [req.params.id]);
      return { pledge, project: updated.rows[0], risk };
    });

    res.status(201).json({
      pledge: { ...result.pledge, amount: Number(result.pledge.amount) },
      project: mapProject(result.project),
      message: `Tài trợ ${Number(result.pledge.amount).toLocaleString('vi-VN')}đ thành công.`,
    });
  }),
);

// ============================================================
// REWARDS
// ============================================================
router.post(
  '/:id/rewards',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const body = parse(rewardSchema, req.body);
    const { rows } = await query(
      `insert into rewards (project_id, title, description, min_amount, quantity_available)
       values ($1, $2, $3, $4, $5) returning *`,
      [req.params.id, body.title, body.description || null, body.min_amount, body.quantity_available],
    );
    res.status(201).json({ reward: mapReward(rows[0]) });
  }),
);

router.patch(
  '/:id/rewards/:rewardId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const body = parse(rewardPatchSchema, req.body);
    const existing = await query('select * from rewards where id = $1 and project_id = $2', [
      req.params.rewardId,
      req.params.id,
    ]);
    if (!existing.rowCount) throw new ApiError(404, 'Không tìm thấy gói tài trợ.');

    const nextAvailable = body.quantity_available ?? Number(existing.rows[0].quantity_available);
    if (nextAvailable < Number(existing.rows[0].quantity_claimed)) {
      throw new ApiError(400, 'Số suất không được nhỏ hơn số đã nhận.');
    }

    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };
    const sets = [];
    for (const key of ['title', 'description', 'min_amount', 'quantity_available']) {
      if (body[key] !== undefined) sets.push(`${key} = ${add(body[key])}`);
    }
    if (!sets.length) throw new ApiError(400, 'Không có trường nào cần cập nhật.');
    const idParam = add(req.params.rewardId);

    const { rows } = await query(`update rewards set ${sets.join(', ')} where id = ${idParam} returning *`, params);
    res.json({ reward: mapReward(rows[0]) });
  }),
);

router.delete(
  '/:id/rewards/:rewardId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const existing = await query(
      'select quantity_claimed from rewards where id = $1 and project_id = $2',
      [req.params.rewardId, req.params.id],
    );
    if (!existing.rowCount) throw new ApiError(404, 'Không tìm thấy gói tài trợ.');
    if (Number(existing.rows[0].quantity_claimed) > 0) {
      throw new ApiError(400, 'Không thể xoá gói đã có người nhận.');
    }
    await query('delete from rewards where id = $1', [req.params.rewardId]);
    res.status(204).end();
  }),
);

// ============================================================
// COLLABORATORS
// ============================================================
router.get(
  '/:id/collaborators',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertCanManage(pool, req.params.id, req.user);
    const { rows } = await query(
      `select pc.user_id, pc.role, pc.invited_at, pc.accepted_at, u.full_name, u.email, u.avatar_url
         from project_collaborators pc join users u on u.id = pc.user_id
        where pc.project_id = $1 order by pc.invited_at`,
      [req.params.id],
    );
    res.json({ items: rows });
  }),
);

router.post(
  '/:id/collaborators',
  requireAuth,
  asyncHandler(async (req, res) => {
    const access = await assertOwner(pool, req.params.id, req.user);
    const body = parse(collaboratorSchema, req.body);
    const userResult = await query(
      `select id, full_name, email, role, status from users where lower(email) = $1`,
      [body.email.toLowerCase()],
    );
    const invitee = userResult.rows[0];
    if (!invitee) throw new ApiError(404, 'Không tìm thấy người dùng với email này.');
    if (invitee.id === req.user.id || invitee.id === access.project.owner_id) {
      throw new ApiError(400, 'Không thể mời chính chủ dự án.');
    }
    if (invitee.status === 'locked') throw new ApiError(400, 'Tài khoản này đang bị khóa.');
    if (invitee.role === 'admin') throw new ApiError(400, 'Không thể mời quản trị viên làm cộng tác viên.');

    const existed = await query(
      'select 1 from project_collaborators where project_id = $1 and user_id = $2',
      [req.params.id, invitee.id],
    );
    if (existed.rowCount) throw new ApiError(409, 'Người này đã là cộng tác viên hoặc đã được mời.');

    const { rows } = await query(
      `insert into project_collaborators (project_id, user_id, role)
       values ($1, $2, $3) returning *`,
      [req.params.id, invitee.id, body.role],
    );

    const project = await query('select title from projects where id = $1', [req.params.id]);
    await notify(pool, invitee.id, {
      type: 'invite',
      content: `${req.user.full_name} mời bạn cộng tác dự án “${project.rows[0].title}”.`,
      link: '/du-an-cua-toi',
    });

    res.status(201).json({
      invitation: { ...rows[0], full_name: invitee.full_name, email: invitee.email },
      message: 'Đã gửi lời mời cộng tác.',
    });
  }),
);

router.patch(
  '/:id/collaborators/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertOwner(pool, req.params.id, req.user);
    const body = parse(z.object({ role: z.enum(['editor', 'moderator']) }), req.body);
    const { rows } = await query(
      `update project_collaborators set role = $1
        where project_id = $2 and user_id = $3 returning *`,
      [body.role, req.params.id, req.params.userId],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy cộng tác viên.');
    res.json({ collaborator: rows[0] });
  }),
);

router.delete(
  '/:id/collaborators/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertOwner(pool, req.params.id, req.user);
    const { rows } = await query(
      `delete from project_collaborators
        where project_id = $1 and user_id = $2 returning user_id`,
      [req.params.id, req.params.userId],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy cộng tác viên.');
    res.status(204).end();
  }),
);

// ============================================================
// PAYOUT REQUEST
// ============================================================
router.post(
  '/:id/payouts',
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertOwner(pool, req.params.id, req.user);
    const body = parse(payoutSchema, req.body);

    const result = await withTransaction(async (client) => {
      const projectResult = await client.query('select * from projects where id = $1 for update', [req.params.id]);
      const project = projectResult.rows[0];
      if (!['active', 'successful'].includes(project.status)) {
        throw new ApiError(400, 'Chỉ dự án đang gây quỹ hoặc thành công mới được yêu cầu giải ngân.');
      }

      const paid = await client.query(
        `select coalesce(sum(amount), 0)::numeric as total from transactions
          where project_id = $1 and type = 'payout' and status in ('pending', 'success')`,
        [req.params.id],
      );
      const available = Number(project.current_amount) - Number(paid.rows[0].total);
      if (body.amount > available) {
        throw new ApiError(400, `Số dư khả dụng chỉ còn ${available.toLocaleString('vi-VN')}đ.`);
      }

      const inserted = await client.query(
        `insert into transactions (project_id, type, amount, method, gateway_ref, status)
         values ($1, 'payout', $2, 'bank_transfer', $3, 'pending') returning *`,
        [req.params.id, body.amount, `PAYOUT-REQ-${Date.now()}`],
      );

      await notifyAdmins(client, {
        type: 'payout',
        content: `Yêu cầu giải ngân ${Number(body.amount).toLocaleString('vi-VN')}đ cho dự án “${project.title}”.`,
        link: '/admin/giai-ngan',
      });

      return inserted.rows[0];
    });

    res.status(201).json({
      transaction: { ...result, amount: Number(result.amount) },
      message: 'Đã gửi yêu cầu giải ngân, chờ admin duyệt.',
    });
  }),
);

export default router;
