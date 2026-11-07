export function createPayPalWebhookController({ service }) {
  return async function paypalWebhook(req, res, next) {
    try {
      const headers = {
        authAlgo: req.get("paypal-auth-algo"),
        certUrl: req.get("paypal-cert-url"),
        transmissionId: req.get("paypal-transmission-id"),
        transmissionSig: req.get("paypal-transmission-sig"),
        transmissionTime: req.get("paypal-transmission-time"),
      };
      const result = await service.processWebhook({ headers, event: req.body });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return next(error);
    }
  };
}
