import { notes } from "./schema";
notes.on({ beforeCreate(data) { data.title = "x"; } });
