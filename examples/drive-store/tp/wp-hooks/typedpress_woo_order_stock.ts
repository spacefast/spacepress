import { db } from "typedpress";
import type { Handler } from "php/wordpress";
import { stockMovements } from "../schema";

const logStock: Handler<"typedpress_woo_order_stock"> = async (drive, order, change, reason) => {
  await db.insert(stockMovements).values({ drive, order, change, reason });
};

export default logStock;
