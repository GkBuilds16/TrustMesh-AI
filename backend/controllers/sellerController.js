
import {
  createSeller,
  getSellerById,
  getAllSellers,
} from "../services/sellerService.js";

export async function registerSeller(req, res, next) {
  try {
    const seller = await createSeller(req.body);

    return res.status(201).json({
      success: true,
      seller,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A seller with this ID already exists.",
      });
    }

    if (
      error.message?.includes("required") ||
      error.message?.includes("must be") ||
      error.message?.includes("Invalid")
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}

export async function fetchSeller(req, res, next) {
  try {
    const seller = await getSellerById(req.params.sellerId);

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found.",
      });
    }

    return res.status(200).json({
      success: true,
      seller,
    });
  } catch (error) {
    next(error);
  }
}

export async function listSellers(req, res, next) {
  try {
    const sellers = await getAllSellers();

    return res.status(200).json({
      success: true,
      count: sellers.length,
      sellers,
    });
  } catch (error) {
    next(error);
  }
}
