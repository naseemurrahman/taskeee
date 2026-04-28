const Task = require('../models/Task');

async function getSummary() {
  const totalTasks = await Task.countDocuments();
  const completedTasks = await Task.countDocuments({ status: 'completed' });
  const pendingTasks = await Task.countDocuments({ status: 'pending' });
  const overdueTasks = await Task.countDocuments({
    dueDate: { $lt: new Date() },
    status: { $ne: 'completed' }
  });

  return {
    totalTasks,
    completedTasks,
    pendingTasks,
    overdueTasks
  };
}

module.exports = {
  getSummary
};
