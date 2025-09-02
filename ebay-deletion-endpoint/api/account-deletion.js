const express = require('express');
const app = express();
app.use(express.json());

// POST endpoint for eBay account deletion notifications
app.post('/account-deletion', (req, res) => {
  console.log('Received deletion notification:', req.body);
  // Always respond 200 OK so eBay knows you accept the notification
  res.status(200).json({ message: 'Received deletion notification' });
});

// For local testing on Vercel dev
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server listening on port ${port}`));
}

module.exports = app;
