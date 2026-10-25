import { ApiError } from '../lib/errors.js';

export async function getProjectAccess(db, projectId, user) {
  const { rows } = await db.query(
    `select id, owner_id, status, end_date, start_date, current_amount, goal_amount
       from projects where id = $1`,
    [projectId],
  );
  const project = rows[0];
  if (!project) return null;

  let isCollaborator = false;
  if (user) {
    const r = await db.query(
      `select 1 from project_collaborators
        where project_id = $1 and user_id = $2 and accepted_at is not null`,
      [projectId, user.id],
    );
    isCollaborator = r.rowCount > 0;
  }

  const isAdmin = user?.role === 'admin';
  const isOwner = !!user && project.owner_id === user.id;

  return {
    project,
    isOwner,
    isCollaborator,
    isAdmin,
    canManage: isOwner || isCollaborator,
    canEditCore: isOwner,
  };
}

export async function assertCanManage(db, projectId, user) {
  const access = await getProjectAccess(db, projectId, user);
  if (!access) throw new ApiError(404, 'Không tìm thấy dự án.');
  if (!access.canManage && !access.isAdmin) {
    throw new ApiError(403, 'Bạn không có quyền quản lý dự án này.');
  }
  return access;
}

export async function assertOwner(db, projectId, user) {
  const access = await getProjectAccess(db, projectId, user);
  if (!access) throw new ApiError(404, 'Không tìm thấy dự án.');
  if (!access.isOwner && !access.isAdmin) {
    throw new ApiError(403, 'Chỉ chủ dự án mới được thực hiện thao tác này.');
  }
  return access;
}
