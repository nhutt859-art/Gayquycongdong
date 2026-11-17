/**
 * db có thể là pool (query) hoặc client trong transaction.
 */
export async function notify(db, userId, { type = 'info', content, link = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link) values ($1, $2, $3, $4)`,
    [userId, type, content, link],
  );
}

export async function notifyAdmins(db, { type = 'info', content, link = null, excludeUserId = null }) {
  await db.query(
    `insert into notifications (user_id, type, content, link)
     select id, $1, $2, $3 from users
      where role = 'admin' and status = 'active'
        and ($4::uuid is null or id <> $4)`,
    [type, content, link, excludeUserId],
  );
}
