import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../lib/errors.js';

const router = Router();

// GET /api/categories — công khai cho trang chủ, khám phá, tạo dự án
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      select c.id, c.name, c.description, c.created_at,
             (select count(*) from projects p where p.category_id = c.id)::int as project_count,
             (select count(*) from projects p where p.category_id = c.id and p.status = 'active')::int as active_project_count
        from categories c
       order by c.name
    `);
    res.json({ items: rows });
  }),
);

export default router;
