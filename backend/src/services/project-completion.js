import { notify, notifyAdmins } from './notifications.js';
import { applyTrustEvent } from './trust.js';

/** Gửi thông báo cho người theo dõi, nhà tài trợ đã thanh toán và cộng tác viên. */
export async function notifyAudience(db, projectId, { type = 'update', content, link, excludeUserId = null }) {
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

/**
 * Thông báo cho toàn bộ các bên liên quan khi dự án đổi trạng thái:
 * chủ dự án, nhà tài trợ, người theo dõi, cộng tác viên và quản trị viên.
 */
export async function notifyStakeholders(
  db,
  project,
  {
    type = 'project',
    content,
    ownerContent = content,
    adminContent = content,
    audienceLink = `/du-an/${project.id}`,
    ownerLink = `/quan-ly/${project.id}`,
    adminLink = null,
    actorId = null,
  },
) {
  await notifyAudience(db, project.id, {
    type,
    content,
    link: audienceLink,
    excludeUserId: actorId,
  });
  if (project.owner_id !== actorId) {
    await notify(db, project.owner_id, { type, content: ownerContent, link: ownerLink });
  }
  await notifyAdmins(db, {
    type,
    content: adminContent,
    link: adminLink,
    excludeUserId: actorId,
  });
}

export function vnDate(value) {
  const raw = String(value || '').slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : raw;
}

/**
 * Tạo yêu cầu giải ngân cho phần tiền chưa được yêu cầu/giải ngân.
 * Trả về null nếu dự án đã được yêu cầu giải ngân toàn bộ.
 */
export async function createPendingPayout(db, project) {
  const paid = await db.query(
    `select coalesce(sum(amount), 0)::numeric as total
       from transactions
      where project_id = $1 and type = 'payout' and status in ('pending', 'success')`,
    [project.id],
  );
  const remaining = Number(project.current_amount) - Number(paid.rows[0].total);
  if (remaining < 1) return null;

  const { rows } = await db.query(
    `insert into transactions (project_id, type, amount, method, gateway_ref, status)
     values ($1, 'payout', $2, 'bank_transfer', $3, 'pending') returning *`,
    [project.id, remaining, `PAYOUT-AUTO-${String(project.id).slice(0, 8).toUpperCase()}`],
  );
  return rows[0];
}

/** Thông báo khi dự án đạt mục tiêu và chuyển sang “Chờ giải ngân”. */
export async function announceCompletion(db, project, { actorId = null, payout = null } = {}) {
  const amountText = Number(project.current_amount).toLocaleString('vi-VN');
  const payoutText = payout
    ? ` Yêu cầu giải ngân ${Number(payout.amount).toLocaleString('vi-VN')}đ đã được tạo và chỉ được duyệt từ ngày ${vnDate(project.end_date)}.`
    : '';

  await notifyStakeholders(db, project, {
    type: 'payout',
    content: `Chiến dịch “${project.title}” đã đạt mục tiêu với ${amountText}đ, ngừng nhận tài trợ và chuyển sang trạng thái “Chờ giải ngân”.${payoutText}`,
    ownerContent: `Dự án “${project.title}” đã đạt mục tiêu với ${amountText}đ và chuyển sang trạng thái “Chờ giải ngân”.${payoutText}`,
    adminContent: `Dự án “${project.title}” đã đạt mục tiêu với ${amountText}đ và đang chờ giải ngân.${payoutText}`,
    adminLink: '/admin/giai-ngan',
    actorId,
  });
}

/**
 * Tự chuyển dự án sang “Chờ giải ngân” khi tiền đã gọi đạt mục tiêu, đồng thời
 * tạo yêu cầu giải ngân chờ admin duyệt (chỉ duyệt được khi tới hạn).
 */
export async function completeProjectIfFunded(db, projectId, { actorId = null } = {}) {
  const { rows } = await db.query(
    `update projects
        set status = 'awaiting_disbursement', completed_at = now()
      where id = $1 and status = 'active' and current_amount >= goal_amount
      returning *`,
    [projectId],
  );
  if (!rows.length) return null;

  const project = rows[0];
  await applyTrustEvent(db, {
    userId: project.owner_id,
    reason: 'campaign_completed',
    referenceId: project.id,
    note: `Hoàn thành chiến dịch “${project.title}”.`,
    createdAt: project.completed_at || new Date(),
  });
  const payout = await createPendingPayout(db, project);
  await announceCompletion(db, project, { actorId, payout });
  return { project, payout };
}
