// utils/reminderPoller.js
const Reminder = require('../models/Reminder');
const sendReminder = require('./sendReminder');

const INTERVAL_MS = Number(process.env.REMINDER_POLL_MS || 5000);
const BATCH = Number(process.env.REMINDER_BATCH || 50);

/**
 * Atomically claim & send reminders due at or before now.
 * Prevents duplicates if you ever run >1 worker.
 */
async function processDueReminders() {
  const now = new Date();

  // Fetch up to BATCH due items
  const due = await Reminder.find({ expiresAt: { $lte: now }, claimedAt: { $exists: false } })
                            .sort({ expiresAt: 1 })
                            .limit(BATCH)
                            .lean();

  for (const r of due) {
    // Try to claim atomically
    const claimed = await Reminder.findOneAndUpdate(
      { _id: r._id, claimedAt: { $exists: false } },
      { $set: { claimedAt: new Date() } },
      { new: true }
    ).lean();

    if (!claimed) continue; // claimed by another loop/worker

    try {
      await sendReminder(claimed);
    } catch (e) {
      console.warn(`[reminderPoller] send failed ${r._id}:`, e?.message || e);
      // optional: unclaim to retry later
      await Reminder.updateOne({ _id: r._id }, { $unset: { claimedAt: 1 } }).catch(()=>{});
    }
  }
}

function startReminderPoller() {
  console.log(`[reminderPoller] starting @ ${INTERVAL_MS}ms interval`);
  const timer = setInterval(processDueReminders, INTERVAL_MS);
  // run once soon after boot
  setTimeout(processDueReminders, 1500);
  return () => clearInterval(timer);
}

module.exports = { startReminderPoller };