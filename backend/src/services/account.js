import { withTransaction } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { notify } from './notifications.js';

const SUSPENDABLE = ['draft', 'pending_review', 'active'];

async function notifyProjectStakeholders(db, project, { content, link, excludeUserId = null, excludeActorId = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link)
     select distinct x.user_id, 'project', $2, $3
       from (
         select user_id from follows where project_id = $1
         union
         select backer_id from pledges where project_id = $1 and status = 'paid'
         union
         select user_id from project_collaborators where project_id = $1 and accepted_at is not null
       ) x
      where ($4::uuid is null or x.user_id <> $4)
        and ($5::uuid is null or x.user_id <> $5)`,
    [project.id, content, link, excludeUserId, excludeActorId],
  );
}

/**
 * Khóa tài khoản: vô hiệu hoá JWT cũ, tạm ngưng các dự án đang chạy của chủ dự án
 * và thông báo cho cộng tác viên, nhà tài trợ, người theo dõi.
 */
export async function lockAccount(userId, { reason = null, actorId = null, shouldNotify = true } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'select id, full_name, email, role, status from users where id = $1 for update',
      [userId],
    );
    const user = rows[0];
    if (!user) throw new ApiError(404, 'Không tìm thấy người dùng.');
    if (user.status === 'locked') {
      return { user, suspendedProjects: [], alreadyLocked: true };
    }

    await client.query(
      `update users
          set status = 'locked',
              token_version = token_version + 1,
              updated_at = now()
        where id = $1`,
      [userId],
    );

    const suspended = await client.query(
      `update projects
          set suspended_from_status = status,
              status = 'suspended',
              updated_at = now()
        where owner_id = $1
          and status = any($2::project_status[])
        returning id, title, suspended_from_status`,
      [userId, SUSPENDABLE],
    );

    if (shouldNotify) {
      const reasonText = reason ? ` Lý do: ${reason}` : '';
      await notify(client, userId, {
        type: 'account',
        content: `Tài khoản của bạn đã bị khóa bởi quản trị viên.${reasonText} Vui lòng liên hệ quản trị viên để được hỗ trợ.`,
        link: '/dang-nhap',
      });

      for (const project of suspended.rows) {
        await notifyProjectStakeholders(client, project, {
          content: `Dự án “${project.title}” tạm ngưng hoạt động vì chủ dự án bị khóa tài khoản. Mọi thao tác quản lý dự án đang bị tạm dừng cho đến khi quản trị viên xử lý.`,
          link: `/du-an/${project.id}`,
          excludeUserId: userId,
          excludeActorId: actorId,
        });
      }
    }

    return {
      user: { ...user, status: 'locked' },
      suspendedProjects: suspended.rows,
      alreadyLocked: false,
    };
  });
}

/**
 * Mở khóa tài khoản: khôi phục trạng thái trước đó cho các dự án bị tạm ngưng
 * và thông báo cho các bên liên quan.
 */
export async function unlockAccount(userId, { actorId = null, shouldNotify = true } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'select id, full_name, email, role, status from users where id = $1 for update',
      [userId],
    );
    const user = rows[0];
    if (!user) throw new ApiError(404, 'Không tìm thấy người dùng.');
    if (user.status !== 'locked') {
      return { user, restoredProjects: [], alreadyActive: true };
    }

    await client.query(
      `update users
          set status = 'active',
              updated_at = now()
        where id = $1`,
      [userId],
    );

    const restored = await client.query(
      `update projects
          set status = coalesce(suspended_from_status, 'draft'),
              suspended_from_status = null,
              updated_at = now()
        where owner_id = $1
          and status = 'suspended'
        returning id, title, status`,
      [userId],
    );

    if (shouldNotify) {
      await notify(client, userId, {
        type: 'account',
        content: 'Tài khoản của bạn đã được mở khóa. Bạn có thể đăng nhập và tiếp tục quản lý dự án.',
        link: '/ca-nhan',
      });

      for (const project of restored.rows) {
        await notifyProjectStakeholders(client, project, {
          content: `Dự án “${project.title}” đã hoạt động trở lại sau khi chủ dự án được mở khóa tài khoản.`,
          link: `/du-an/${project.id}`,
          excludeUserId: userId,
          excludeActorId: actorId,
        });
      }
    }

    return {
      user: { ...user, status: 'active' },
      restoredProjects: restored.rows,
      alreadyActive: false,
    };
  });
}
