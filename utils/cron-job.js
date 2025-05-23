import cron from "node-cron";

export const scheduleDailyJob = () => {
  cron.schedule(
    "* * * * *", // Every day at 12:00 AM UTC
    () => {
      console.log("✅ Running daily cron job at 12:00 AM UTC");
      // Add your actual task logic here
    },
    {
      timezone: "UTC"
    }
  );
};
