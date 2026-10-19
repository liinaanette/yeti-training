import { runReminders } from "./_cron.js";

export default (req, res) => runReminders("morning", req, res);
