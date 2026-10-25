import { Router } from 'express';
import { z } from 'zod';
import { pool, query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { mapProject } from '../lib/mappers.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';

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
        (select count(*) from projects where status = 'successful')::int as successful_projects,
        (select count(*) from projects where status = 'failed')::int as failed_projects,
        (select count(*) from projects)::int as total_projects,
        (select count(*) from fraud_flags where review_status = 'pending')::int as open_flags,
        (select count(*) from reports where status = 'open')::int as open_reports,
        (select count(*) from users where status = 'active')::int as active_users,
        (select count(*) from projects where status = 'pending_review')::int as pending_projects,
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
    res.json({
      ...s,
      success_rate: decided > 0 ? Math.round((s.successful_projects / decided) * 100) : 0,
      chart: chart.rows,
      top_categories: categories.rows,
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
              u.email as owner_email,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as paid_backers
         from projects p
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
         ${where}
        order by p.created_at desc`,
      params,
    );
    res.json({ items: rows.map(mapProject) });
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
              p.id as project_id, p.title as project_title, p.current_amount,
              u.id as owner_id, u.full_name as owner_name, u.email as owner_email
         from transactions t
         join projects p on p.id = t.project_id
         join users u on u.id = p.owner_id
        where t.type = 'payout' ${extra}
        order by case when t.status = 'pending' then 0 else 1 end, t.created_at desc`,
      params,
    );
    res.json({ items: rows.map((r) => ({ ...r, amount: Number(r.amount), current_amount: Number(r.current_amount) })) });
  }),
);

router.post(
  '/payouts/:id/approve',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `update transactions set status = 'success'
        where id = $1 and type = 'payout' and status = 'pending' returning *`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(400, 'Yêu cầu giải ngân không ở trạng thái chờ duyệt.');
    const payout = rows[0];

    const project = await query('select owner_id, title from projects where id = $1', [payout.project_id]);
    await notify(pool, project.rows[0].owner_id, {
      type: 'payout',
      content: `Yêu cầu giải ngân ${Number(payout.amount).toLocaleString('vi-VN')}đ cho “${project.rows[0].title}” đã được duyệt.`,
      link: `/quan-ly/${payout.project_id}`,
    });

    res.json({ transaction: { ...payout, amount: Number(payout.amount) }, message: 'Đã duyệt giải ngân.' });
  }),
);

router.post(
  '/payouts/:id/reject',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `update transactions set status = 'failed'
        where id = $1 and type = 'payout' and status = 'pending' returning *`,
      [req.params.id],
    );
    if (!rows.length) throw new ApiError(400, 'Yêu cầu giải ngân không ở trạng thái chờ duyệt.');
    const payout = rows[0];

    const project = await query('select owner_id, title from projects where id = $1', [payout.project_id]);
    await notify(pool, project.rows[0].owner_id, {
      type: 'payout',
      content: `Yêu cầu giải ngân ${Number(payout.amount).toLocaleString('vi-VN')}đ cho “${project.rows[0].title}” bị từ chối.`,
      link: `/quan-ly/${payout.project_id}`,
    });

    res.json({ transaction: { ...payout, amount: Number(payout.amount) }, message: 'Đã từ chối giải ngân.' });
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
          `update projects set status = 'canceled' where id = $1 returning title, owner_id`,
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
        await query(`update users set status = 'locked' where id = $1`, [flag.entity_id]);
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
             (select count(*) from pledges pl where pl.backer_id = u.id and pl.status = 'paid')::int as paid_pledges
        from users u
       order by u.created_at
    `);
    res.json({ items: rows.map((r) => ({ ...r, trust_score: Number(r.trust_score) })) });
  }),
);

router.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const body = parse(userStatusSchema, req.body);
    if (req.params.id === req.user.id && body.status === 'locked') {
      throw new ApiError(400, 'Bạn không thể tự khóa tài khoản của mình.');
    }

    const { rows } = await query(
      `update users set status = $1 where id = $2
       returning id, full_name, email, role, status`,
      [body.status, req.params.id],
    );
    if (!rows.length) throw new ApiError(404, 'Không tìm thấy người dùng.');

    if (body.status === 'locked') {
      await notify(pool, req.params.id, {
        type: 'account',
        content: 'Tài khoản của bạn đã bị tạm khóa bởi quản trị viên.',
        link: '/dang-nhap',
      });
    }

    res.json({ user: rows[0], message: body.status === 'locked' ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.' });
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
