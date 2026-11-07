
export const RISK_RULES = {
  FLAGGED_SELLER: {
    points: 60,
    description: "Target seller is marked FLAGGED in the shared seller workspace",
  },

  SHARED_BENEFICIARY: {
    points: 35,
    description: "Seller shares a beneficiary identifier with a flagged account",
  },

  HIGH_TRANSACTION_VELOCITY: {
    points: 25,
    description: "Transaction frequency exceeds the configured test threshold",
  },

  UNUSUAL_TRANSACTION_AMOUNT: {
    points: 20,
    description: "Transaction amount exceeds the configured buyer baseline",
  },

  INCOMPLETE_SELLER_VERIFICATION: {
    points: 10,
    description: "Seller verification is incomplete",
  },
};
