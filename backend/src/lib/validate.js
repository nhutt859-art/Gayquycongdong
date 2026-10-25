import { ApiError } from './errors.js';

/**
 * Chạy zod schema và trả về dữ liệu đã chuẩn hoá.
 * Thông báo lỗi đầu tiên được trả về nguyên văn để frontend hiển thị.
 */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new ApiError(400, `${field}${issue?.message || 'Dữ liệu không hợp lệ.'}`, result.error.issues);
  }
  return result.data;
}
