const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@version2.gkckoqo.mongodb.net/?appName=version2`;
const targetEmail = "tom@tom.com";

async function makeAdmin() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db("shopDB");

        console.log(`Attempting to make ${targetEmail} a SUPER ADMIN...`);

        const result = await db.collection("Users").updateOne(
            { email: targetEmail },
            {
                $set: {
                    role: 'super_admin',
                    email: targetEmail,
                    name: "Tom Admin", // Placeholder if new
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        if (result.upsertedCount > 0) {
            console.log(`SUCCESS: ${targetEmail} was CREATED and is now a SUPER ADMIN.`);
        } else if (result.modifiedCount > 0) {
            console.log(`SUCCESS: ${targetEmail} was UPDATED to SUPER ADMIN.`);
        } else {
            console.log(`NO CHANGE: ${targetEmail} is already a SUPER ADMIN.`);
        }

        const user = await db.collection("Users").findOne({ email: targetEmail });
        console.log("Current Database Entry:", user);

    } catch (error) {
        console.error("Error:", error.message);
    } finally {
        await client.close();
    }
}

makeAdmin();
