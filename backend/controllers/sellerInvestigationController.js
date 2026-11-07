
import {
  investigateSeller,
} from "../services/sellerInvestigationService.js";

export async function fetchSellerInvestigation(req, res, next) {
  try {
    const report = await investigateSeller(req.params.sellerId);

    if (!report) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    return res.status(200).json({
      success: true,
      investigation: report,
    });
  } catch (error) {
    next(error);
  }
}
