import express from "express";
import Controller from "./controller.js";

const router = express.Router();

router.post('/webhook',Controller.webhook);

export default router;