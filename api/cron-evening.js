import { runReminders } from "./_cron.js";

export default (req, res) => runReminders("evening", req, res);
