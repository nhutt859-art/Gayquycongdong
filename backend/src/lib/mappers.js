export const USER_PUBLIC_COLUMNS = `
  id, full_name, email, phone, avatar_url, role, kyc_status, trust_score, status,
  email_verified_at, created_at
`;

export function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone || null,
    avatar_url: row.avatar_url || null,
    role: row.role,
    kyc_status: row.kyc_status,
    trust_score: Number(row.trust_score),
    status: row.status,
    email_verified: Boolean(row.email_verified_at),
    email_verified_at: row.email_verified_at || null,
    created_at: row.created_at,
  };
}

export function mapProject(row) {
  if (!row) return null;
  const goal = Number(row.goal_amount);
  const current = Number(row.current_amount);
  return {
    ...row,
    goal_amount: goal,
    current_amount: current,
    ai_success_score: Number(row.ai_success_score),
    fraud_risk_score: Number(row.fraud_risk_score),
    progress: goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0,
    reward_count: row.reward_count !== undefined ? Number(row.reward_count) : undefined,
    is_following: row.is_following ?? false,
    can_manage: row.can_manage ?? false,
    my_role: row.my_role ?? null,
    can_pledge: row.can_pledge ?? false,
  };
}

export function mapReward(row) {
  return {
    ...row,
    min_amount: Number(row.min_amount),
    quantity_available: Number(row.quantity_available),
    quantity_claimed: Number(row.quantity_claimed),
    remaining: Number(row.quantity_available) - Number(row.quantity_claimed),
  };
}
