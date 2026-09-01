import { Elysia } from "elysia";
import { deliveryPlansRoutes } from "./routes/delivery-plans.routes";

export const deliveryPlansModule = () => new Elysia().use(deliveryPlansRoutes);
