const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;




// Middleware
const admin = require("firebase-admin");
const fs = require('fs');
const path = require('path');

//const serviceAccountKeyPath = path.join(__dirname, 'serviceAccountKey.json');

if (process.env.fb_service_key) {
  try {
    const decoded = Buffer.from(process.env.fb_service_key, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(decoded);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin Initialized successfully from ENV.");
  } catch (error) {
    console.error("❌ FAILED to initialize Firebase Admin from ENV:", error);
  }
} else if (fs.existsSync(serviceAccountKeyPath)) {
  try {
    const serviceAccount = require(serviceAccountKeyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin Initialized successfully from serviceAccountKey.json.");
  } catch (error) {
    console.error("❌ FAILED to initialize Firebase Admin from file:", error);
  }
} else {
  console.error("CRITICAL: Firebase Admin NOT initialized. verifyFBToken WILL FAIL.");
}

// Middleware
//app.use(cors());
const allowedOrigins = [
  "http://localhost:5173",
 
  "https://onebeforethelast-4b04d.web.app",
  "https://your-frontend.vercel.app",
  "https://your-frontend.netlify.app",
  "https://ph10scic2.web.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('All Headers received:', req.headers); // Debugging: See all headers
  console.log('Auth Header extraction: index line 25', authHeader);
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized: No header" });
  }
  const token = authHeader.split(" ")[1];
  console.log('header in the index.js line 30', token);

  if (!token) {
    return res.status(401).send({ message: "Unauthorized: Invalid token format" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("❌ Firebase Token Verification Error:", error.code, error.message);
    // If you want to see the full error in logs:
    // console.error(error); 
    return res.status(403).send({ message: "Forbidden: Token Invalid", error: error.message, code: error.code });
  }
}

// Database Connection URI
const uri = `mongodb+srv://ahadul70_db_user:${process.env.DB_PASS}@version2.gkckoqo.mongodb.net/?appName=version2`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // await client.connect();
    const allproductsCollection = client.db("shopDB").collection("allproducts");
    const myImports = client.db("shopDB").collection("Imports");
    const myExports = client.db("shopDB").collection("Exports");
    const usersdb = client.db("shopDB").collection("Users");

    console.log("Database and collections initialized.");

    // --- Middlewares ---
    const verifySuperAdmin = async (req, res, next) => {
      const email = req.user.email;
      console.log('--- verifySuperAdmin Check ---');
      console.log('Request Email:', email);
      const query = { email: email };
      const user = await usersdb.findOne(query);
      console.log('DB User Found:', user ? user.email : 'NULL', 'Role:', user ? user.role : 'NULL');

      if (user?.role === 'super_admin') {
        next();
      } else {
        console.log('ACCESS DENIED: Role is', user?.role);
        return res.status(403).send({ message: 'forbidden access admin' });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const user = await usersdb.findOne({ email });
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        next();
      } else {
        return res.status(403).send({ message: 'forbidden: admin only' });
      }
    };

    // --- Admin Product Approval Routes ---

    // Get all pending products
    app.get("/admin/pending-products", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const pendingProducts = await allproductsCollection.find({ status: "pending" }).toArray();
        res.send(pendingProducts);
      } catch (err) {
        res.status(500).send({ message: "Error fetching pending products" });
      }
    });

    // Approve a product (Updated to sync with Exports)
    app.patch("/admin/products/approve/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        // Find the product first to get details for sync
        const product = await allproductsCollection.findOne({ _id: new ObjectId(id) });

        if (!product) return res.status(404).send({ message: "Product not found" });

        const result = await allproductsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved" } }
        );

        // Sync with myExports if name and seller match
        await myExports.updateMany(
          { name: product.name, seller: product.seller, status: "pending" },
          { $set: { status: "approved" } }
        );

        res.send(result);
      } catch (err) {
        console.error("Approve product error:", err);
        res.status(500).send({ message: "Error approving product" });
      }
    });

    // Approve an export record (optional but keeps consistency)
    app.patch("/admin/exports/approve/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await myExports.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved" } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error approving export" });
      }
    });

    // Get all approved exports
    app.get("/admin/approved-exports", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const approvedExports = await myExports.find({ status: "approved" }).toArray();
        res.send(approvedExports);
      } catch (err) {
        res.status(500).send({ message: "Error fetching approved exports" });
      }
    });

    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersdb.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    // storing user data
    app.post("/users", async (req, res) => {
      const newUser = req.body;

      const email = req.body.email;
      const query = { email: email };
      const existingUser = await usersdb.findOne(query);
      if (existingUser) {
        res.send({
          message: "user already exits. do not need to insert again",
        });
      } else {
        const result = await usersdb.insertOne(newUser);
        res.send(result);
      }
    });

    // ✅ Insert one product for super admin

    app.post("/products", async (req, res) => {
      try {
        const rawProduct = req.body;
        if (!rawProduct || typeof rawProduct !== "object") {
          return res.status(400).json({ error: "Invalid product data" });
        }

        const newProduct = {
          ...rawProduct,
          seller: rawProduct.seller || "Anonymous",
          status: "pending",
          createdAt: new Date(),
        };
        const result = await allproductsCollection.insertOne(newProduct);
        res.send(result);
      } catch (err) {
        console.error("Insert error:", err);
        res.status(500).json({ error: "Failed to insert product" });
      }
    });

    // ✅ Get all products

    app.get("/products", async (req, res) => {
      const cursor = allproductsCollection.find({ status: "approved" }).sort({ rating: -1 });
      const products = await cursor.toArray();
      res.send(products);
    });
    //Get all popular products
    app.get("/popularproducts", async (req, res) => {
      try {
        const cursor = allproductsCollection.find({ status: "approved" }).sort({ rating: -1 }).limit(6);
        const products = await cursor.toArray();
        res.send(products);
      } catch (err) {
        console.error("Error fetching popular products:", err);
        res.status(500).json({ error: "Failed to fetch popular products" });
      }
    });
    //Get all  products details by id
    app.get("/products/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const product = await allproductsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!product)
          return res.status(404).json({ error: "Product not found" });
        res.json(product);
      } catch (err) {
        console.error("Error fetching product:", err);
        res.status(500).json({ error: "Server error" });
      }
    });

    //this delete for super admin
    app.delete("/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await allproductsCollection.deleteOne(query);
      res.send(result);
    });

    //  edit products uploaded by admin

    app.patch("/products/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = { $set: updatedData };
      const result = await allproductsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    /// this will get all the imports in the my imports page

    app.get("/myimports", verifyFBToken, async (req, res) => {
      try {
        const email = req.user.email; // Secure email from verified token
        const query = { importer_email: email };
        const cursor = myImports.find(query).sort({ _id: -1 });
        const imports = await cursor.toArray();
        res.send(imports);
      } catch (err) {
        console.error("Error fetching imports:", err);
        res.status(500).send({ error: "Failed to fetch imports" });
      }
    });

    // get details for one imported product
    app.get("/myimports/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.user.email;
        const query = { _id: new ObjectId(id), importer_email: email };
        const result = await myImports.findOne(query);

        if (!result)
          return res.status(404).json({ error: "Product not found or unauthorized" });
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
      }
    });

    // this will add products to my imports page/list / db
    app.post("/myimports", verifyFBToken, async (req, res) => {
      try {
        const newImport = req.body;
        const { productId, quantity } = newImport;
        if (!productId || !quantity)
          return res
            .status(400)
            .json({ error: "Missing productId or quantity" });

        // Ensure importer_email matches the verified token
        newImport.importer_email = req.user.email;
        newImport.status = "pending"; // Default status

        const importResult = await myImports.insertOne(newImport);

        const updateResult = await allproductsCollection.updateOne(
          { _id: new ObjectId(productId) },
          { $inc: { quantity: -parseInt(quantity) } }
        );

        res.send({ importResult, updateResult });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Import failed" });
      }
    });

    // --- Admin Import Management Routes ---

    // Get pending imports
    app.get("/admin/pending-imports", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        // Fetch where status is pending OR status is missing (for legacy data)
        const query = { $or: [{ status: "pending" }, { status: { $exists: false } }] };
        const result = await myImports.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error fetching pending imports" });
      }
    });

    // Get approved imports
    app.get("/admin/approved-imports", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const result = await myImports.find({ status: "approved" }).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error fetching approved imports" });
      }
    });

    // Approve an import
    app.patch("/admin/imports/approve/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await myImports.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "approved" } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error approving import" });
      }
    });

    //this will remove from my imports page
    app.delete("/myimports/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const email = req.user.email;
      const query = { _id: new ObjectId(id), importer_email: email };
      const result = await myImports.deleteOne(query);
      res.send(result);
    });

    // this will get all the from my export
    app.get("/myexports", verifyFBToken, async (req, res) => {
      try {
        const email = req.user.email; // Secure email from verified token
        const query = { email: email };

        const exportsData = await myExports.find(query).toArray();
        res.send(exportsData);
      } catch (err) {
        console.error("Error fetching exports:", err);
        res.status(500).json({ error: "Failed to fetch exports" });
      }
    });

    // this will edit products uploaded my export
    app.patch("/myexports/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const email = req.user.email;
        const updatedData = req.body;
        delete updatedData._id; // prevent overwrite

        const query = { _id: new ObjectId(id), email: email };
        const updateDoc = { $set: updatedData };

        const result = await myExports.updateOne(query, updateDoc);
        res.send(result);
      } catch (err) {
        console.error("Update error:", err);
        res.status(500).send({ message: "Server error", error: err.message });
      }
    });

    // this will delete products upload my export

    app.delete("/myexports/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const email = req.user.email;
      const query = { _id: new ObjectId(id), email: email };
      const result = await myExports.deleteOne(query);
      res.send(result);
    });

    // this will add products to my exports page/list / db
    app.post("/addexports", verifyFBToken, async (req, res) => {
      try {
        const newExport = req.body;

        // basic validation
        if (!newExport.name || !newExport.price || !newExport.quantity) {
          return res
            .status(400)
            .json({ error: "Name, price, and quantity are required" });
        }

        const exportDoc = {
          email: req.user.email, // Secure email from verified token
          seller: newExport.seller || req.user.name || "Anonymous",
          name: newExport.name,
          image: newExport.image || "",
          price: Number(newExport.price),
          originCountry: newExport.originCountry || "",
          rating: Number(newExport.rating) || 0,
          quantity: Number(newExport.quantity),
          status: "pending",
          createdAt: new Date(),
        };

        const result = await myExports.insertOne(exportDoc);
        res
          .status(201)
          .json({ message: "Export product added successfully", data: result });
      } catch (err) {
        console.error("Error adding export product:", err);
        res.status(500).json({ error: "Failed to add export product" });
      }
    });

    // ✅ Confirm connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("✅ Connected to MongoDB successfully!");
  } catch (err) {
    console.error(err);
  }
  // ❌ DO NOT close client here
}
run().catch(console.dir);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
  });
}

module.exports = app;
