import { Router } from 'express';
import { z } from 'zod';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { mapProject, KYC_COLUMNS, mapKyc } from '../lib/mappers.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { lockAccount, unlockAccount } from '../services/account.js';
import { getFraudModelInfo, getModelCard } from '../services/ai.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'Vui lòng nhập lý do từ chối (tối thiểu 5 ký tự).').max(1000),
});
const reviewSchema = z.object({
  review_status: z.enum(['confirmed', 'false_positive'], { message: 'Trạng thái duyệt không hợp lệ.' }),
});
const reportPatchSchema = z.object({
  status: z.enum(['open', 'reviewed', 'closed']),
});
const userStatusSchema = z.object({
  status: z.enum(['active', 'locked']),
});
const categorySchema = z.object({
  name: z.string().trim().min(2, 'Tên danh mục tối thiểu 2 ký tự.').max(80),
  description: z.string().trim().max(500).optional().nullable(),
});
const categoryPatchSchema = categorySchema.partial();

// ============================================================
// THỐNG KÊ
// ============================================================
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const summary = await query(`
      select
        (select coalesce(sum(current_amount), 0) from projects)::numeric as total_raised,
        (select count(*) from projects where status = 'active')::int as active_projects,
        (select count(*) from projects where status in ('successful', 'in_progress'))::int as successful_projects,
        (select count(*) from projects where status = 'failed')::int as failed_projects,
        (select count(*) from projects)::int as total_projects,
        (select count(*) from fraud_flags where review_status = 'pending')::int as open_flags,
        (select count(*) from reports where status = 'open')::int as open_reports,
        (select count(*) from users where status = 'active')::int as active_users,
        (select count(*) from projects where status = 'pending_review')::int as pending_projects,
        (select count(*) from projects where status = 'suspended')::int as suspended_projects,
        (select count(*) from pledges where status = 'paid')::int as paid_pledges
    `);

    const chart = await query(`
      select d.day::date::text as day,
             count(pl.id)::int as pledges,
             coalesce(sum(pl.amount), 0)::numeric as amount
        from generate_series(current_date - 6, current_date, interval '1 day') d(day)
        left join pledges pl
               on pl.created_at::date = d.day::date
              and pl.status = 'paid'
       group by d.day
       order by d.day
    `);

    const categories = await query(`
      select c.name, count(p.id)::int as projects,
             coalesce(sum(p.current_amount), 0)::numeric as total
        from categories c
        left join projects p on p.category_id = c.id
       group by c.id, c.name
       order by total desc
    `);

    const s = summary.rows[0];
    const decided = s.successful_projects + s.failed_projects;
    const [aiModel, fraudModel] = await Promise.all([getModelCard(), getFraudModelInfo()]);
    res.json({
      ...s,
      success_rate: decided > 0 ? Math.round((s.successful_projects / decided) * 100) : 0,
      chart: chart.rows,
      top_categories: categories.rows,
      ai_model: aiModel,
      fraud_model: fraudModel,
    });
  }),
);

// ============================================================
// DỰ ÁN
// ============================================================
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '').trim();
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = 'where p.status = $1';
    }
    const { rows } = await query(
      `select p.*, c.name as category_name, u.full_name as owner_name,
              u.email as owner_email, u.phone as owner_phone,
              u.kyc_status as owner_kyc_status, u.trust_score as owner_trust_score,
              u.status as owner_status,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as paid_backers,
              coalesce((
                select json_agg(json_build_object(
                  'user_id', pc.user_id,
                  'full_name', cu.full_name,
                  'email', cu.email,
                  'role', pc.role,
                  'invited_at', pc.invited_at,
                  'accepted_at', pc.accepted_at
                ) order by pc.invited_at)
                  from project_collaborators pc
                  join users cu on cu.id = pc.user_id
                 where pc.project_id = p.id
              ), '[]'::json) as collaborators
         from projects p
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
         ${where}
        order by p.created_at desc`,
      params,
    );
    res.json({
      items: rows.map((row) => ({
        ...mapProject(row),
        owner_trust_score: Number(row.owner_trust_score || 0),
      })),
    });
  }),
);

router.post(
  '/projects/:id/approve',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `update projects set status = 'active', reject_reason = null
        where id = $1 and status = 'pending_review' returning *`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(400, 'Dự án không ở trạng thái chờ duyệt.');
    const project = rows[0];

    await notify(pool, project.owner_id, {
      type: 'project',
      content: `Dự án “${project.title}” đã được duyệt và công khai.`,
      link: `/du-an/${project.id}`,
    });

    res.json({ project: mapProject(project), message: 'Đã duyệt công khai dự án.' });
  }),
);

router.post(
  '/projects/:id/reject',
  asyncHandler(async (req, res) => {
    const body = parse(rejectSchema, req.body);
    const { rows } = await query(
      `update projects set status = 'canceled', reject_reason = $1
        where id = $2 and status = 'pending_review' returning *`,
      [body.reason, req.params.id],
    );
    if (!rows.length) throw new ApiError(400, 'Dự án không ở trạng thái chờ duyệt.');
    const project = rows[0];

    await notify(pool, project.owner_id, {
      type: 'project',
      content: `Dự án “${project.title}” bị từ chối. Lý do: ${body.reason}`,
      link: `/quan-ly/${project.id}`,
    });

    res.json({ project: mapProject(project), message: 'Đã từ chối dự án.' });
  }),
);

router.post(
  '/projects/:id/refund',
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const projectResult = await client.query('select * from projects where id = $1 for update', [req.params.id]);
      if (!projectResult.rowCount) throw new ApiError(404, 'Không tìm thấy dự án.');
      const project = projectResult.rows[0];
      if (!['failed', 'canceled'].includes(project.status)) {
        throw new ApiError(400, 'Chỉ hoàn tiền cho dự án thất bại hoặc đã dừng.');
      }

      const pledges = await client.query(
        `select id, backer_id, amount from pledges
          where project_id = $1 and status = 'paid' for update`,
        [req.params.id],
      );
      if (!pledges.rowCount) throw new ApiError(400, 'Không còn khoản tài trợ nào cần hoàn.');

      let total = 0;
      for (const pledge of pledges.rows) {
        await client.query(`update pledges set status = 'refunded' where id = $1`, [pledge.id]);
        await client.query(
          `insert into transactions (pledge_id, project_id, type, amount, method, gateway_ref, status)
           values ($1, $2, 'refund', $3, 'bank_transfer', $4, 'success')`,
          [pledge.id, req.params.id, pledge.amount, `REFUND-${String(pledge.id).slice(0, 8)}`],
        );
        total += Number(pledge.amount);
        await notify(client, pledge.backer_id, {
          type: 'refund',
          content: `Khoản tài trợ ${Number(pledge.amount).toLocaleString('vi-VN')}đ cho “${project.title}” đã được hoàn.`,
          link: '/ca-nhan',
        });
      }

      await notify(client, project.owner_id, {
        type: 'refund',
        content: `Admin đã hoàn tiền ${total.toLocaleString('vi-VN')}đ cho nhà tài trợ của dự án “${project.title}”.`,
        link: `/quan-ly/${project.id}`,
      });

      return { count: pledges.rowCount, total };
    });

    res.json({
      message: `Đã hoàn tiền ${result.total.toLocaleString('vi-VN')}đ cho ${result.count} khoản tài trợ.`,
      ...result,
    });
  }),
);

// ============================================================
// GIẢI NGÂN
// ============================================================
async function notifyProjectAudience(db, projectId, { type = 'payout', content, link, excludeUserId = null }) {
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

router.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || '').trim();
    const params = [];
    let extra = '';
    if (status) {
      params.push(status);
      extra = 'and t.status = $1';
    }
    const { rows } = await query(
      `select t.id, t.amount, t.status, t.method, t.gateway_ref, t.created_at,
              t.processed_by, t.processed_at,
              p.id as project_id, p.title as project_title, p.current_amount,
              p.status as project_status, p.end_date, p.completed_at,
              u.id as owner_id, u.full_name as owner_name, u.email as owner_email,
              a.full_name as processed_by_name,
              case
                when t.status = 'pending'
                 and p.status in ('successful', 'in_progress')
                 and p.end_date <= current_date then true
                else false
              end as can_disburse,
              case
                when t.status <> 'pending' then null
                when p.status not in ('successful', 'in_progress') then 'Dự án chưa hoàn thành.'
                when p.end_date > current_date
                  then 'Chờ tới ngày kết thúc ' || to_char(p.end_date, 'DD/MM/YYYY') || ' mới được giải ngân.'
                else null
              end as block_reason
         from transactions t
         join projects p on p.id = t.project_id
         join users u on u.id = p.owner_id
         left join users a on a.id = t.processed_by
        where t.type = 'payout' ${extra}
        order by case when t.status = 'pending' then 0 else 1 end, t.created_at desc`,
      params,
    );
    res.json({
      items: rows.map((r) => ({
        ...r,
        amount: Number(r.amount),
        current_amount: Number(r.current_amount),
      })),
    });
  }),
);

router.post(
  '/payouts/:id/approve',
  asyncHandler(async (req, res) => {
    const payout = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select t.*, p.owner_id, p.title, p.status as project_status, p.end_date
           from transactions t
           join projects p on p.id = t.project_id
          where t.id = $1 and t.type = 'payout'
          for update of t, p`,
        [req.params.id],
      );
      if (!rows.length) throw new ApiError(404, 'Không tìm thấy yêu cầu giải ngân.');
      const row = rows[0];
      if (row.status !== 'pending') {
        throw new ApiError(400, 'Yêu cầu giải ngân không ở trạng thái chờ duyệt.');
      }
      if (!['successful', 'in_progress'].includes(row.project_status)) {
        throw new ApiError(400, 'Dự án chưa hoàn thành nên chưa thể giải ngân.');
      }
      if (row.end_date > new Date().toISOString().slice(0, 10)) {
        throw new ApiError(
          400,
          `Chưa tới ngày kết thúc chiến dịch (${String(row.end_date).split('-').reverse().join('/')}). Chỉ được giải ngân đúng hạn.`,
        );
      }

      const updated = await client.query(
        `update transactions
            set status = 'success', processed_by = $1, processed_at = now()
          where id = $2
          returning *`,
        [req.user.id, row.id],
      );

      if (row.project_status === 'successful') {
        await client.query(
          `update projects
              set status = 'in_progress',
                  completed_at = coalesce(completed_at, now())
            where id = $1`,
          [row.project_id],
        );
      }

      const amountText = Number(row.amount).toLocaleString('vi-VN');
      const link = `/quan-ly/${row.project_id}`;
      await notify(client, row.owner_id, {
        type: 'payout',
        content: `Dự án “${row.title}” đã được giải ngân ${amountText}đ. Dự án chuyển sang trạng thái “Đang triển khai”; bạn có thể cập nhật tiến độ.`,
        link,
      });
      await notifyProjectAudience(client, row.project_id, {
        type: 'payout',
        content: `Dự án “${row.title}” đã được giải ngân ${amountText}đ và chuyển sang trạng thái đang triển khai.`,
        link: `/du-an/${row.project_id}`,
      });

      return updated.rows[0];
    });

    res.json({
      transaction: { ...payout, amount: Number(payout.amount) },
      message: 'Đã duyệt giải ngân và chuyển dự án sang trạng thái đang triển khai.',
    });
  }),
);

router.post(
  '/payouts/:id/reject',
  asyncHandler(async (req, res) => {
    const payout = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select t.*, p.owner_id, p.title
           from transactions t
           join projects p on p.id = t.project_id
          where t.id = $1 and t.type = 'payout'
          for update of t`,
        [req.params.id],
      );
      if (!rows.length) throw new ApiError(404, 'Không tìm thấy yêu cầu giải ngân.');
      const row = rows[0];
      if (row.status !== 'pending') {
        throw new ApiError(400, 'Yêu cầu giải ngân không ở trạng thái chờ duyệt.');
      }

      const updated = await client.query(
        `update transactions
            set status = 'failed', processed_by = $1, processed_at = now()
          where id = $2
          returning *`,
        [req.user.id, row.id],
      );

      await notify(client, row.owner_id, {
        type: 'payout',
        content: `Yêu cầu giải ngân ${Number(row.amount).toLocaleString('vi-VN')}đ cho “${row.title}” bị từ chối.`,
        link: `/quan-ly/${row.project_id}`,
      });

      return updated.rows[0];
    });

    res.json({
      transaction: { ...payout, amount: Number(payout.amount) },
      message: 'Đã từ chối giải ngân.',
    });
  }),
);

// ============================================================
// GIAN LẬN
// ============================================================
router.get(
  '/fraud-flags',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      select f.*,
             case f.entity_type
               when 'project' then (select title from projects where id = f.entity_id)
               when 'user' then (select full_name from users where id = f.entity_id)
               when 'pledge' then (
                 select p.title from pledges pl join projects p on p.id = pl.project_id where pl.id = f.entity_id
               )
             end as entity_label,
             (select email from users where id = f.entity_id) as user_email,
             (select email from users where id = f.reviewed_by) as reviewer_email
        from fraud_flags f
       order by case when f.review_status = 'pending' then 0 else 1 end, f.risk_score desc, f.flagged_at desc
    `);
    res.json({ items: rows.map((r) => ({ ...r, risk_score: Number(r.risk_score) })) });
  }),
);

router.patch(
  '/fraud-flags/:id',
  asyncHandler(async (req, res) => {
    const body = parse(reviewSchema, req.body);

    const { rows } = await query(
      `update fraud_flags
          set review_status = $1, reviewed_by = $2, reviewed_at = now()
        where id = $3 returning *`,
      [body.review_status, req.user.id, req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy cảnh báo.');
    const flag = rows[0];

    if (body.review_status === 'confirmed') {
      if (flag.entity_type === 'project') {
        const p = await query(
          `update projects
              set status = 'canceled',
                  suspended_from_status = null
            where id = $1
            returning title, owner_id`,
          [flag.entity_id],
        );
        if (p.rowCount) {
          await notify(pool, p.rows[0].owner_id, {
            type: 'fraud',
            content: `Dự án “${p.rows[0].title}” đã bị tạm dừng do xác nhận gian lận.`,
            link: `/quan-ly/${flag.entity_id}`,
          });
        }
      } else if (flag.entity_type === 'user') {
        await lockAccount(flag.entity_id, {
          reason: 'AI xác nhận dấu hiệu gian lận.',
          actorId: req.user.id,
        });
      } else if (flag.entity_type === 'pledge') {
        await query(`update pledges set status = 'failed' where id = $1`, [flag.entity_id]);
        await query(
          `update transactions set status = 'failed' where pledge_id = $1 and type = 'payment'`,
          [flag.entity_id],
        );
      }
    }

    res.json({
      flag: { ...flag, risk_score: Number(flag.risk_score) },
      message: body.review_status === 'confirmed' ? 'Đã xác nhận và xử lý.' : 'Đã đánh dấu báo nhầm.',
    });
  }),
);

router.get(
  '/reports',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      select r.*, p.title as project_title, u.full_name as reporter_name, u.email as reporter_email
        from reports r
        join projects p on p.id = r.project_id
        join users u on u.id = r.reporter_id
       order by case when r.status = 'open' then 0 else 1 end, r.created_at desc
    `);
    res.json({ items: rows });
  }),
);

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const body = parse(reportPatchSchema, req.body);
    const { rows } = await query(
      `update reports set status = $1::report_status,
              reviewed_at = case when $1::report_status = 'open' then null else now() end
        where id = $2 returning *`,
      [body.status, req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy báo cáo.');
    res.json({ report: rows[0], message: 'Đã cập nhật trạng thái báo cáo.' });
  }),
);

// ============================================================
// NGƯỜI DÙNG
// ============================================================
router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      select u.id, u.full_name, u.email, u.phone, u.role, u.kyc_status, u.trust_score,
             u.status, u.email_verified_at, u.created_at,
             (select count(*) from projects p where p.owner_id = u.id)::int as owned_projects,
             (select count(*) from project_collaborators pc where pc.user_id = u.id and pc.accepted_at is not null)::int as collaborating_projects,
             (select count(*) from pledges pl where pl.backer_id = u.id and pl.status = 'paid')::int as paid_pledges
        from users u
       order by u.created_at
    `);
    res.json({ items: rows.map((r) => ({ ...r, trust_score: Number(r.trust_score) })) });
  }),
);

// GET /api/admin/users/:id/kyc — hồ sơ KYC đầy đủ kèm ảnh giấy tờ
router.get(
  '/users/:id/kyc',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `select id, full_name, email, phone, status, role, ${KYC_COLUMNS}
         from users where id = $1`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy người dùng.');
    const row = rows[0];
    res.json({
      user: {
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone || null,
        role: row.role,
        account_status: row.status,
      },
      kyc: mapKyc(row, { mask: false, includeImages: true }),
    });
  }),
);

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const body = parse(userStatusSchema, req.body);
    if (req.params.id === req.user.id && body.status === 'locked') {
      throw new ApiError(400, 'Bạn không thể tự khóa tài khoản của mình.');
    }

    if (body.status === 'locked') {
      const result = await lockAccount(req.params.id, { actorId: req.user.id });
      res.json({
        user: result.user,
        suspended_projects: result.suspendedProjects,
        message: result.alreadyLocked
          ? 'Tài khoản đã ở trạng thái khóa.'
          : `Đã khóa tài khoản và tạm ngưng ${result.suspendedProjects.length} dự án đang hoạt động.`,
      });
      return;
    }

    const result = await unlockAccount(req.params.id, { actorId: req.user.id });
    res.json({
      user: result.user,
      restored_projects: result.restoredProjects,
      message: result.alreadyActive
        ? 'Tài khoản đã ở trạng thái hoạt động.'
        : `Đã mở khóa tài khoản và khôi phục ${result.restoredProjects.length} dự án.`,
    });
  }),
);

// ============================================================
// DANH MỤC
// ============================================================
router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      select c.*, (select count(*) from projects p where p.category_id = c.id)::int as project_count
        from categories c order by c.name
    `);
    res.json({ items: rows });
  }),
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const body = parse(categorySchema, req.body);
    const existed = await query('select 1 from categories where lower(name) = lower($1)', [body.name]);
    if (existed.rowCount) throw new ApiError(409, 'Danh mục đã tồn tại.');

    const { rows } = await query(
      'insert into categories (name, description) values ($1, $2) returning *',
      [body.name, body.description || null],
    );
    res.status(201).json({ category: rows[0] });
  }),
);

router.patch(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const body = parse(categoryPatchSchema, req.body);
    const params = [];
    const add = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    const sets = [];
    if (body.name !== undefined) sets.push(`name = ${add(body.name)}`);
    if (body.description !== undefined) sets.push(`description = ${add(body.description)}`);
    if (!sets.length) throw new ApiError(400, 'Không có trường nào cần cập nhật.');
    const idParam = add(req.params.id);

    const { rows } = await query(`update categories set ${sets.join(', ')} where id = ${idParam} returning *`, params);
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy danh mục.');
    res.json({ category: rows[0] });
  }),
);

router.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const used = await query('select count(*)::int as total from projects where category_id = $1', [req.params.id]);
    if (used.rows[0].total > 0) {
      throw new ApiError(400, 'Không thể xoá danh mục đang có dự án.');
    }
    const { rows } = await query('delete from categories where id = $1 returning id', [req.params.id]);
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy danh mục.');
    res.status(204).end();
  }),
);

export default router;
