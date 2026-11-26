import { db } from "spacepress/server";
import type { Handler } from "spacepress/server/wp";
import { stockMovements } from "../schema";

const logStock: Handler<"spacepress_woo_order_stock"> = async (drive, order, change, reason) => {
  await db.insert(stockMovements).values({ drive, order, change, reason });
};

export default logStock;
