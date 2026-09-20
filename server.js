const express = require("express");
const path = require("path");
const session = require("express-session");
const multer = require("multer");

const {
    S3Client,
    ListObjectsV2Command,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const AWS_REGION = "eu-north-1";
const BUCKET_NAME = "prm-secure-cloud-storage";

const s3 = new S3Client({
    region: AWS_REGION
});

const upload = multer({
    storage: multer.memoryStorage()
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            "secure-cloud-project-session",

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            secure: process.env.RENDER === "true",
            sameSite: "lax"
        }
    })
);

// ======================================================
// USERS
// ======================================================

let users = [
    {
        id: 1,
        username: "project-admin",
        password: "Secure@123",
        role: "admin",
        status: "approved"
    }
];

// ======================================================
// ACTIVITY
// ======================================================

let activities = [];

// ======================================================
// LOGIN CHECK
// ======================================================

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            loggedIn: false,
            message: "Please login first."
        });
    }

    next();
}

// ======================================================
// ADMIN CHECK
// ======================================================

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    if (req.session.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Admin access required."
        });
    }

    next();
}

// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ======================================================
// REGISTER PAGE
// ======================================================

app.get("/register.html", (req, res) => {
    res.sendFile(path.join(__dirname, "register.html"));
});

// ======================================================
// DASHBOARD PAGE
// ======================================================

app.get("/dashboard.html", requireLogin, (req, res) => {
    console.log("DASHBOARD REQUEST");
    console.log("DASHBOARD SESSION:", req.session.user);

    res.sendFile(path.join(__dirname, "dashboard.html"));
});

// ======================================================
// REGISTER
// ======================================================

app.post("/register", (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: "Username and password are required."
        });
    }

    const existingUser = users.find(
        user =>
            user.username.toLowerCase() ===
            username.toLowerCase()
    );

    if (existingUser) {
        return res.status(400).json({
            success: false,
            message: "Username already exists."
        });
    }

    const newUser = {
        id: Date.now(),
        username,
        password,
        role: "user",
        status: "pending"
    };

    users.push(newUser);

    activities.push({
        username,
        action: "Registration Request",
        time: new Date().toISOString()
    });

    res.json({
        success: true,
        message:
            "Registration submitted. Please wait for admin approval."
    });
});

// ======================================================
// LOGIN
// ======================================================

app.post("/login", (req, res) => {
    console.log("LOGIN REQUEST");

    const username = String(
        req.body.username || ""
    ).trim();

    const password = String(
        req.body.password || ""
    ).trim();

    const user = users.find(
        u =>
            u.username === username &&
            u.password === password
    );

    if (!user) {
        return res.status(401).json({
            success: false,
            message: "Invalid username or password."
        });
    }

    if (user.status !== "approved") {
        return res.status(403).json({
            success: false,
            message:
                "Your account is waiting for admin approval."
        });
    }

    req.session.regenerate(err => {
        if (err) {
            console.error("Session regenerate error:", err);

            return res.status(500).json({
                success: false,
                message: "Session creation failed."
            });
        }

        req.session.user = {
            username: user.username,
            role: user.role
        };

        activities.push({
            username: user.username,
            action: "User Login",
            time: new Date().toISOString()
        });

        req.session.save(saveError => {
            if (saveError) {
                console.error(
                    "Session save error:",
                    saveError
                );

                return res.status(500).json({
                    success: false,
                    message: "Session save failed."
                });
            }

            console.log(
                "SESSION CREATED:",
                req.session.user
            );

            res.json({
                success: true,
                message: "Login successful.",
                user: {
                    username: user.username,
                    role: user.role
                }
            });
        });
    });
});

// ======================================================
// CURRENT USER
// ======================================================

app.get("/current-user", requireLogin, (req, res) => {
    console.log(
        "CURRENT USER SESSION:",
        req.session.user
    );

    res.json({
        success: true,
        loggedIn: true,

        user: {
            username: req.session.user.username,
            role: req.session.user.role
        },

        // Compatibility fields
        username: req.session.user.username,
        role: req.session.user.role
    });
});

// ======================================================
// LOGOUT
// ======================================================

app.get("/logout", (req, res) => {
    if (!req.session) {
        return res.redirect("/");
    }

    req.session.destroy(err => {
        if (err) {
            console.error("Logout error:", err);

            return res.status(500).send(
                "Logout failed."
            );
        }

        res.clearCookie("connect.sid");

        res.redirect("/");
    });
});

app.get("/logout/", (req, res) => {
    res.redirect("/logout");
});

app.post("/logout", (req, res) => {
    if (!req.session) {
        return res.json({
            success: true
        });
    }

    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Logout failed."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            success: true
        });
    });
});

// ======================================================
// ADMIN USERS
// ======================================================

app.get("/admin/users", requireAdmin, (req, res) => {
    const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status
    }));

    res.json({
        success: true,
        users: safeUsers
    });
});

// ======================================================
// APPROVE
// ======================================================

app.post(
    "/admin/approve/:id",
    requireAdmin,
    (req, res) => {
        const id = Number(req.params.id);

        const user = users.find(
            u => u.id === id
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        user.status = "approved";

        activities.push({
            username:
                req.session.user.username,

            action:
                `User Approved: ${user.username}`,

            time: new Date().toISOString()
        });

        res.json({
            success: true,
            message: "User approved successfully."
        });
    }
);

// ======================================================
// REJECT
// ======================================================

app.post(
    "/admin/reject/:id",
    requireAdmin,
    (req, res) => {
        const id = Number(req.params.id);

        const user = users.find(
            u => u.id === id
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        user.status = "rejected";

        activities.push({
            username:
                req.session.user.username,

            action:
                `User Rejected: ${user.username}`,

            time: new Date().toISOString()
        });

        res.json({
            success: true,
            message: "User rejected successfully."
        });
    }
);

// ======================================================
// UPLOAD
// ======================================================

app.post(
    "/upload",
    requireLogin,
    upload.single("file"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No file selected."
                });
            }

            const username =
                req.session.user.username;

            const key =
                `users/${username}/${Date.now()}-${req.file.originalname}`;

            await s3.send(
                new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: key,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                })
            );

            activities.push({
                username,
                action:
                    `File Uploaded: ${req.file.originalname}`,
                time: new Date().toISOString()
            });

            res.json({
                success: true,
                message:
                    "File uploaded successfully."
            });

        } catch (error) {
            console.error("Upload error:", error);

            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// ======================================================
// LIST FILES
// ======================================================

app.get(
    "/files",
    requireLogin,
    async (req, res) => {
        try {
            const currentUser =
                req.session.user;

            let prefix = "users/";

            if (currentUser.role !== "admin") {
                prefix =
                    `users/${currentUser.username}/`;
            }

            const result =
                await s3.send(
                    new ListObjectsV2Command({
                        Bucket: BUCKET_NAME,
                        Prefix: prefix
                    })
                );

            const objects =
                result.Contents || [];

            const files = objects.map(obj => {
                const parts =
                    obj.Key.split("/");

                const owner =
                    parts[1] || "";

                return {
                    name:
                        parts.slice(2).join("/") ||
                        obj.Key,

                    key: obj.Key,

                    owner,

                    size:
                        obj.Size || 0,

                    lastModified:
                        obj.LastModified
                };
            });

            res.json({
                success: true,
                files
            });

        } catch (error) {
            console.error(
                "List files error:",
                error
            );

            res.status(500).json({
                success: false,
                message: error.message,
                files: []
            });
        }
    }
);

// ======================================================
// DOWNLOAD
// ======================================================

app.get(
    "/download",
    requireLogin,
    async (req, res) => {
        try {
            const requestedKey =
                String(req.query.key || "");

            if (!requestedKey) {
                return res.status(400).send(
                    "File key is required."
                );
            }

            const currentUser =
                req.session.user;

            const allowedPrefix =
                `users/${currentUser.username}/`;

            if (
                currentUser.role !== "admin" &&
                !requestedKey.startsWith(
                    allowedPrefix
                )
            ) {
                return res.status(403).send(
                    "Access denied."
                );
            }

            const result =
                await s3.send(
                    new GetObjectCommand({
                        Bucket: BUCKET_NAME,
                        Key: requestedKey
                    })
                );

            const filename =
                requestedKey.split("/").pop() ||
                "download";

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );

            if (result.ContentType) {
                res.setHeader(
                    "Content-Type",
                    result.ContentType
                );
            }

            result.Body.pipe(res);

            activities.push({
                username:
                    currentUser.username,

                action:
                    `File Downloaded: ${filename}`,

                time:
                    new Date().toISOString()
            });

        } catch (error) {
            console.error(
                "Download error:",
                error
            );

            res.status(500).send(
                "Download failed."
            );
        }
    }
);

// ======================================================
// DELETE
// ======================================================

app.delete(
    "/delete",
    requireLogin,
    async (req, res) => {
        try {
            const requestedKey =
                String(req.query.key || "");

            if (!requestedKey) {
                return res.status(400).json({
                    success: false,
                    message:
                        "File key is required."
                });
            }

            const currentUser =
                req.session.user;

            const allowedPrefix =
                `users/${currentUser.username}/`;

            if (
                currentUser.role !== "admin" &&
                !requestedKey.startsWith(
                    allowedPrefix
                )
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied."
                });
            }

            await s3.send(
                new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: requestedKey
                })
            );

            const filename =
                requestedKey.split("/").pop() ||
                "file";

            activities.push({
                username:
                    currentUser.username,

                action:
                    `File Deleted: ${filename}`,

                time:
                    new Date().toISOString()
            });

            res.json({
                success: true,
                message:
                    "File deleted successfully."
            });

        } catch (error) {
            console.error(
                "Delete error:",
                error
            );

            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
);

// ======================================================
// ACTIVITY
// ======================================================

app.get(
    "/activity",
    requireLogin,
    (req, res) => {
        const currentUser =
            req.session.user;

        if (currentUser.role === "admin") {
            return res.json({
                success: true,
                activities
            });
        }

        const userActivities =
            activities.filter(
                activity =>
                    activity.username ===
                    currentUser.username &&
                    (
                        activity.action.startsWith(
                            "User Login"
                        ) ||
                        activity.action.startsWith(
                            "File Uploaded"
                        ) ||
                        activity.action.startsWith(
                            "File Downloaded"
                        ) ||
                        activity.action.startsWith(
                            "File Deleted"
                        )
                    )
            );

        res.json({
            success: true,
            activities:
                userActivities
        });
    }
);

// ======================================================
// STATIC FILES
// ======================================================

app.use(
    express.static(__dirname)
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
    PORT,
    HOST,
    () => {
        console.log(
            `Secure Cloud Access running at http://${HOST}:${PORT}`
        );

        console.log(
            "AWS Region:",
            AWS_REGION
        );

        console.log(
            "S3 Bucket:",
            BUCKET_NAME
        );

        console.log(
            "GET /logout route enabled"
        );
    }
);