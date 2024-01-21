const express = require('express');
const mysql = require('mysql2/promise');
const { getCloudSqlConnector } = require('@google-cloud/sqlcommenter');

// Environment variables
const port = process.env.PORT || 8080;
const connectionName = process.env.INSTANCE_CONNECTION_NAME; // e.g., 'project:region:instance'
const dbUser = process.env.SQL_USER;
const dbPassword = process.env.SQL_PASSWORD || ''; // Ensure this matches your configuration
const dbName = process.env.SQL_DATABASE;

// Initialize Cloud SQL connector
const connector = getCloudSqlConnector();
const dbConfig = {
  user: dbUser,
  password: dbPassword,
  database: dbName,
  // For MySQL, the connection name is formatted as 'project:region:instance'
  socketPath: `/cloudsql/${connectionName}`
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to connect to the database
async function connectToDatabase(req, res, next) {
  try {
    req.db = await mysql.createPool({ ...dbConfig, ...await connector('mysql') });
    next();
  } catch (err) {
    console.error('Database connection failed:', err);
    res.status(500).send('Database connection failed');
  }
}

app.use(connectToDatabase);

// Example endpoint to handle POST requests for new orders
app.post('/api/order', async (req, res) => {
  const { name, notes } = req.body;
  const query = 'INSERT INTO orders (name, notes) VALUES (?, ?)';

  try {
    const [result] = await req.db.query(query, [name, notes]);
    res.json({ success: true, orderId: result.insertId });
  } catch (err) {
    console.error('Error in inserting order:', err);
    res.status(500).send('Error in processing order');
  }
});

// Endpoint to retrieve all orders
app.get('/api/orders', async (req, res) => {
  try {
    const [results] = await req.db.query('SELECT * FROM orders');
    res.json(results);
  } catch (err) {
    console.error('Error retrieving orders:', err);
    res.status(500).send('Error retrieving orders');
  }
});

app.get('/api/get-order-ready-time', async (req, res) => {
  try {
    const [results] = await req.db.query('SELECT value FROM settings WHERE `key` = "orderReadyTime"');
    if (results.length > 0) {
      res.json({ orderReadyTime: results[0].value });
    } else {
      res.status(404).send('Order ready time setting not found');
    }
  } catch (err) {
    console.error('Error fetching order ready time:', err);
    res.status(500).send('Error fetching order ready time');
  }
});

app.get('/api/get-order-taking-state', async (req, res) => {
  try {
    const [results] = await req.db.query('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"');
    if (results.length > 0) {
      res.json({ value: results[0].value });
    } else {
      res.status(404).send('Order taking setting not found');
    }
  } catch (err) {
    console.error('Error fetching order taking status:', err);
    res.status(500).send('Error fetching order taking status');
  }
});

app.get('/api/order/:orderId', async (req, res) => {
  const orderId = req.params.orderId;

  try {
    const [results] = await req.db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (results.length > 0) {
      res.json(results[0]);
    } else {
      res.status(404).send('Order not found');
    }
  } catch (err) {
    console.error('Error retrieving order:', err);
    res.status(500).send('Error retrieving order');
  }
});

// Endpoint to toggle order taking status
app.post('/api/toggle-order-taking', async (req, res) => {
  try {
    const [currentValueResult] = await req.db.query('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"');
    if (currentValueResult.length === 0) {
      return res.status(404).send('Order taking setting not found');
    }
    const currentValue = currentValueResult[0].value;
    const newValue = currentValue === '1' ? '0' : '1';
    await req.db.query('UPDATE settings SET value = ? WHERE `key` = "orderTakingEnabled"', [newValue]);
    res.json({ success: true, message: 'Order taking toggled', newValue: newValue });
  } catch (err) {
    console.error('Error updating order taking status:', err);
    res.status(500).send('Error updating order taking status');
  }
});

app.post('/api/update-order-ready-time', async (req, res) => {
  const { newTime } = req.body;

  try {
    await req.db.query('UPDATE settings SET value = ? WHERE `key` = "orderReadyTime"', [newTime]);
    res.json({ success: true, message: 'Order ready time updated' });
  } catch (err) {
    console.error('Error updating order ready time:', err);
    res.status(500).send('Error updating order ready time');
  }
});

// Endpoint to serve an order
app.post('/api/serve-order', async (req, res) => {
  const { orderId } = req.body;

  try {
    await req.db.beginTransaction();
    await req.db.query('UPDATE orders SET served_at = NOW() WHERE id = ?', [orderId]);
    await req.db.query('INSERT INTO served_orders (id, name, order_details, created_at, served_at) SELECT id, name, order_details, created_at, NOW() FROM orders WHERE id = ?', [orderId]);
    await req.db.query('DELETE FROM orders WHERE id = ?', [orderId]);
    await req.db.commit();
    res.json({ success: true, message: 'Order served' });
  } catch (err) {
    await req.db.rollback();
    console.error('Error serving order:', err);
    res.status(500).send('Error serving order');
  }
});

// Fetch all available toast types
app.get('/api/toast-types', async (req, res) => {
  try {
    const [results] = await req.db.query('SELECT * FROM toast_types WHERE available = TRUE');
    res.json(results);
  } catch (err) {
    console.error('Error fetching toast types:', err);
    res.status(500).send('Error fetching toast types');
  }
});

app.post('/api/add-toast-type', async (req, res) => {
  const { code, type } = req.body;

  try {
    const [result] = await req.db.query('INSERT INTO toast_types (code, type) VALUES (?, ?)', [code, type]);
    res.json({ success: true, message: 'Toast type added', typeId: result.insertId });
  } catch (err) {
    console.error('Error adding toast type:', err);
    res.status(500).send('Error adding toast type');
  }
});

app.post('/api/remove-toast-type', async (req, res) => {
const { id } = req.body;
try {
const [result] = await req.db.query('UPDATE toast_types SET available = FALSE WHERE id = ?', [id]);
res.json({ success: true, message: 'Toast type removed', affectedRows: result.affectedRows });
} catch (err) {
console.error('Error removing toast type:', err);
res.status(500).send('Error removing toast type');
}
});
app.get('/5min-average', async (req, res) => {
try {
const [results] = await req.db.query('SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, served_at)) AS average_serve_time FROM served_orders WHERE served_at >= NOW() - INTERVAL 5 MINUTE');
const averageServeTime = results[0].average_serve_time || 0;
res.json({ averageServeTime: averageServeTime });
} catch (err) {
console.error('Error calculating 5-min average serve time:', err);
res.status(500).send('Error calculating average serve time');
}
});
app.use(express.static('public'));
app.listen(port, () => {
console.log(`Server running at http://localhost:${port}`);
});