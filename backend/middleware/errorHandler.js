export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (!err.status || err.status >= 500) {
    console.error("Request failed", {
      status: err.status || 500,
      code: typeof err.code === "string" ? err.code : "INTERNAL_ERROR",
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message:
      err.expose || process.env.NODE_ENV !== "production"
        ? err.message
        : "Internal server error",
  });
}
