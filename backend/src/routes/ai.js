import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { optionalAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { getModelCard, predictSuccess } from '../services/ai.js';

const router = Router();

const estimateSchema = z.object({
  category_id: z.string().uuid('Danh mục không hợp lệ.'),
  goal_amount: z.coerce.number().int().min(100000).max(100_000_000_000),
  description: z.string().max(5000).optional().default(''),
  rewards_count: z.coerce.number().int().min(0).max(20).optional().default(0),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  duration_days: z.coerce.number().int().min(1).max(365).optional(),
});

function durationFrom(body) {
  if (body.duration_days) return body.duration_days;
  if (body.start_date && body.end_date) {
    const days = Math.ceil((Date.parse(body.end_date) - Date.parse(body.start_date)) / 86_400_000);
    if (Number.isFinite(days) && days > 0) return days;
  }
  return 45;
}

// POST /api/ai/estimate — ước tính trước khi tạo dự án, có giải thích từng tín hiệu
router.post(
  '/estimate',
  rateLimit({ name: 'ai-estimate-ip', windowMs: 60 * 1000, max: 60 }),
  optionalAuth,
  asyncHandler(async (req, res) => {
    const body = parse(estimateSchema, req.body);
    const prediction = await predictSuccess({
      categoryId: body.category_id,
      goalAmount: body.goal_amount,
      rewardsCount: body.rewards_count,
      description: body.description,
      durationDays: durationFrom(body),
      ownerId: req.user?.id || null,
      ownerTrust: req.user?.trust_score ?? 60,
      ownerKyc: req.user?.kyc_status ?? 'none',
    });
    res.json({ prediction });
  }),
);

// GET /api/ai/model — model card công khai để minh bạch cách tính
router.get(
  '/model',
  asyncHandler(async (_req, res) => {
    res.json({ model: await getModelCard() });
  }),
);

export default router;
