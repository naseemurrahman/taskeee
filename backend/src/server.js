'use strict';
// (file truncated for brevity — unchanged parts remain identical)
// ADD THIS LINE AFTER statsRoutes registration
const analyticsRoutes = require('./routes/analytics');

// later in routes section
app.use('/api/v1/analytics', analyticsRoutes);

// rest of file unchanged
