/**
 * db có thể là pool (query) hoặc client trong transaction.
 */
export async function notify(db, userId, { type = 'info', content, link = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link) values ($1, $2, $3, $4)`,
    [userId, type, content, link],
  );
}

export async function notifyAdmins(db, { type = 'info', content, link = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link)
     select id, $1, $2, $3 from users where role = 'admin' and status = 'active'`,
    [type, content, link],
  );
}
