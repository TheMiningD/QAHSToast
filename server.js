const express = require('express');
const mysql = require('mysql');
const connection = mysql.createConnection({
  host: 'qahs-toast:us-central1:qahstoast',
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE,
});

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

connection.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL Database.');
});

// Endpoint to handle POST requests for new orders
app.post('/api/order', (req, res) => {
    const { name, notes } = req.body;
    console.log('Notes:', notes);

    // Reconstruct orderDetails from the individual fields
    let orderDetails = {};
    for (const key in req.body) {
        if (key.startsWith('toastType') || key.startsWith('quantity')) {
            orderDetails[key] = req.body[key];
        }
    }

    // Check if orderDetails is empty, set to empty object if so
    const detailsToStore = Object.keys(orderDetails).length === 0 ? '{}' : JSON.stringify(orderDetails);

    const query = 'INSERT INTO orders (name, order_details, notes) VALUES (?, ?, ?)';
    connection.query(query, [name, detailsToStore, notes], (err, result) => {
    console.log('Notes 2:', notes);
        if (err) {
            console.error('Error in inserting order:', err);
            return res.status(500).send('Error in processing order');
        }
        res.json({ success: true, orderId: result.insertId });
    });
});


// Endpoint to retrieve all orders
app.get('/api/orders', (req, res) => {
    connection.query('SELECT * FROM orders', (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

app.get('/api/get-order-ready-time', (req, res) => {
    connection.query('SELECT value FROM settings WHERE `key` = "orderReadyTime"', (err, results) => {
        if (err) {
            console.error('Error fetching order ready time:', err);
            return res.status(500).send('Error fetching order ready time');
        }
        if (results.length > 0) {
            res.json({ orderReadyTime: results[0].value });
        } else {
            res.status(404).send('Order ready time setting not found');
        }
    });
});


app.get('/api/get-order-taking-state', (req, res) => {
    connection.query('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"', (err, results) => {
        if (err) {
            return res.status(500).send('Error fetching order taking status');
        }
        if (results.length > 0) {
            res.json({ value: results[0].value });
        } else {
            res.status(404).send('Order taking setting not found');
        }
    });
});

app.get('/api/order/:orderId', (req, res) => {
    const orderId = req.params.orderId;

    connection.query('SELECT * FROM orders WHERE id = ?', [orderId], (err, results) => {
        if (err) {
            res.status(500).send('Error retrieving order');
        } else {
            if (results.length > 0) {
                res.json(results[0]);
            } else {
                res.status(404).send('Order not found');
            }
        }
    });
});

// Endpoint to toggle order taking status
app.post('/api/toggle-order-taking', (req, res) => {
    // Fetch the current value
    connection.query('SELECT value FROM settings WHERE `key` = "orderTakingEnabled"', (err, results) => {
        if (err) {
            console.error('Error fetching order taking status:', err);
            return res.status(500).send('Error fetching order taking status');
        }
        if (results.length === 0) {
            return res.status(404).send('Order taking setting not found');
        }

        // Determine the new value
        const currentValue = results[0].value;
        const newValue = currentValue === '1' ? '0' : '1';

        // Update with the new value
        connection.query('UPDATE settings SET value = ? WHERE `key` = "orderTakingEnabled"', [newValue], (err, result) => {
            if (err) {
                console.error('Error updating order taking status:', err);
                return res.status(500).send('Error updating order taking status');
            }
            res.json({ success: true, message: 'Order taking toggled', newValue: newValue });
        });
    });
});

app.post('/api/update-order-ready-time', (req, res) => {
    const { newTime } = req.body;
    connection.query('UPDATE settings SET value = ? WHERE `key` = "orderReadyTime"', [newTime], (err, result) => {
        if (err) {
            console.error('Error updating order ready time:', err);
            return res.status(500).send('Error: ' + err.message);  // Send back the error message
        }
        res.json({ success: true, message: 'Order ready time updated' });
    });
});




// Endpoint to serve an order
app.post('/api/serve-order', (req, res) => {
    const { orderId } = req.body; // Make sure to validate and sanitize this input

    connection.beginTransaction((err) => {
        if (err) { throw err; }

        // Update the order with the served_at timestamp
        connection.query('UPDATE orders SET served_at = NOW() WHERE id = ?', [orderId], (error, results) => {
            if (error) {
                return connection.rollback(() => {
                    throw error;
                });
            }

            // Move the order to the served_orders table
connection.query('INSERT INTO served_orders (id, name, order_details, created_at, served_at) SELECT id, name, order_details, created_at, NOW() FROM orders WHERE id = ?', [orderId], (error, results) => {
                if (error) {
                    return connection.rollback(() => {
                        throw error;
                    });
                }

                connection.query('DELETE FROM orders WHERE id = ?', [orderId], (error, results) => {
                    if (error) {
                        return connection.rollback(() => {
                            throw error;
                        });
                    }
                    connection.commit((err) => {
                        if (err) {
                            return connection.rollback(() => {
                                throw err;
                            });
                        }
                        console.log('Order served and moved to served_orders table');
                        res.json({ success: true, message: 'Order served' });
                    });
                });
            });
        });
    });
});

// Fetch all available toast types
app.get('/api/toast-types', (req, res) => {
    connection.query('SELECT * FROM toast_types WHERE available = TRUE', (err, results) => {
        if (err) return res.status(500).send('Error fetching toast types');
        res.json(results);
    });
});

app.post('/api/add-toast-type', (req, res) => {
    const { code, type } = req.body;

    // Check if both code and type are provided
    if (!code || !type) {
        return res.status(400).send('Both code and type are required');
    }

    // Insert the new toast type with its code
    connection.query('INSERT INTO toast_types (code, type) VALUES (?, ?)', [code, type], (err, results) => {
        if (err) {
            console.error('Error adding toast type:', err);
            return res.status(500).send('Error adding toast type');
        }
        res.json({ success: true, message: 'Toast type added' });
    });
});


// Remove a toast type
app.post('/api/remove-toast-type', (req, res) => {
    const { id } = req.body;
    connection.query('UPDATE toast_types SET available = FALSE WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).send('Error removing toast type');
        res.json({ success: true, message: 'Toast type removed' });
    });
});


app.get('/5min-average', (req, res) => {
    connection.query(
        'SELECT AVG(TIMESTAMPDIFF(SECOND, created_at, served_at)) AS average_serve_time FROM served_orders WHERE served_at >= NOW() - INTERVAL 5 MINUTE',
        (err, results) => {
            if (err) {
                console.error('Error calculating 5-min average serve time:', err);
                return res.status(500).send('Error calculating average serve time');
            }

            const averageServeTime = results[0].average_serve_time;
            res.json({ averageServeTime: averageServeTime || 0 }); // Send 0 if no data is available
        }
    );
});

// Static files middleware
app.use(express.static('public'));

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});