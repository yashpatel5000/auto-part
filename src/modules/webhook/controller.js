import { Service } from "./service.js";

class Controller {
  static async webhook(req, res) {
    try {
      await Service.webhook(req.body);
      return res.status(200).json({
        message: "Part status changed successfully.",
      });
    } catch (error) {
      return res.status(500).json({
        message: "Internal server error",
      });
    }
  }
}

export default Controller;
