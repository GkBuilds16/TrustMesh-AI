
export function decideRiskAction(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("Risk score must be a number between 0 and 100");
  }

  if (score >= 60) {
    return "BLOCK";
  }

  if (score >= 30) {
    return "REVIEW";
  }

  return "ALLOW";
}
