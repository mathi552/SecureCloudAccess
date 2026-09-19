const express = require("express");
const path = require("path");
const multer = require("multer");
const session = require("express-session");

const {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
    DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const BUCKET_NAME = "prm-secure-cloud-storage";
const AWS_REGION = "eu-north-1";

// ========================================
// AWS S3
// ========================================

const s3 = new S3Client({
    region: AWS_REGION
});

// ========================================
// MIDDLEWARE
// ========================================

app.use(express.urlencoded({
    extended: true
}));

app.use(express.json());

// ========================================
// SESSION
// ========================================

app.use(
    session({
        secret: "secure-cloud-access-session-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 24 * 60 * 60 * 1000
        }
    })
);

// ========================================
// MULTER
// ========================================

const upload = multer({
    storage: multer.memoryStorage()
});

// ========================================
// USERS
// ========================================

let users = [
    {
        username: "project-admin",
        password: "Secure@123",
        role: "admin",
        status: "approved"
    }
];

// ========================================
// ACTIVITY LOG
// ========================================

let activities = [];

// ========================================
// ACTIVITY HELPER
// ========================================

function addActivity(username, action, details = "") {
    activities.unshift({
        username: username,
        action: action,
        details: details,
        time: new Date().toISOString()
    });
}

// ========================================
// LOGIN
// ========================================

app.post("/login", (req, res) => {

    console.log("LOGIN REQUEST");

    const username = req.body.username;
    const password = req.body.password;

    const user = users.find(
        item =>
            item.username === username &&
            item.password === password
    );

    if (!user) {

        console.log("LOGIN FAILED");

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

    req.session.user = {
        username: user.username,
        role: user.role
    };

    addActivity(
        user.username,
        "User Login",
        "User logged into the system."
    );

    req.session.save(error => {

        if (error) {

            console.error(
                "SESSION SAVE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Unable to create session."
            });
        }

        console.log(
            "SESSION CREATED:",
            req.session.user
        );

        res.json({
            success: true,
            username: user.username,
            role: user.role
        });
    });
});

// ========================================
// REGISTER
// ========================================

app.post("/register", (req, res) => {

    const username = req.body.username;
    const password = req.body.password;

    if (!username || !password) {

        return res.status(400).json({
            success: false,
            message:
                "Username and password are required."
        });
    }

    const existingUser = users.find(
        item => item.username === username
    );

    if (existingUser) {

        return res.status(409).json({
            success: false,
            message:
                "Username already exists."
        });
    }

    users.push({
        username: username,
        password: password,
        role: "user",
        status: "pending"
    });

    addActivity(
        username,
        "Registration Request",
        "New user requested access."
    );

    res.json({
        success: true,
        message:
            "Registration submitted. Please wait for admin approval."
    });
});

// ========================================
// LOGIN CHECK
// ========================================

function requireLogin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/");
    }

    next();
}

// ========================================
// ADMIN CHECK
// ========================================

function requireAdmin(req, res, next) {

    if (
        !req.session.user ||
        req.session.user.role !== "admin"
    ) {

        return res.status(403).json({
            success: false,
            message: "Admin access required."
        });
    }

    next();
}

// ========================================
// CURRENT USER
// ========================================

app.get("/current-user", (req, res) => {

    console.log(
        "CURRENT USER SESSION:",
        req.session.user
    );

    if (!req.session.user) {

        return res.json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        username: req.session.user.username,
        role: req.session.user.role
    });
});

// ========================================
// DASHBOARD
// ========================================

app.get("/dashboard.html", (req, res) => {

    console.log("DASHBOARD REQUEST");

    console.log(
        "DASHBOARD SESSION:",
        req.session.user
    );

    res.sendFile(
        path.join(
            __dirname,
            "dashboard.html"
        )
    );
});

// ========================================
// ADMIN USERS
// ========================================

app.get(
    "/admin/users",
    requireAdmin,
    (req, res) => {

        const safeUsers = users.map(user => ({
            username: user.username,
            role: user.role,
            status: user.status
        }));

        res.json(safeUsers);
    }
);

// ========================================
// APPROVE USER
// ========================================

app.post(
    "/admin/approve/:username",
    requireAdmin,
    (req, res) => {

        const username =
            req.params.username;

        const user = users.find(
            item => item.username === username
        );

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        user.status = "approved";

        addActivity(
            username,
            "User Approved",
            "Registration request approved by admin."
        );

        res.json({
            success: true,
            message:
                "User approved successfully."
        });
    }
);

// ========================================
// REJECT USER
// ========================================

app.post(
    "/admin/reject/:username",
    requireAdmin,
    (req, res) => {

        const username =
            req.params.username;

        const user = users.find(
            item => item.username === username
        );

        if (!user) {

            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        user.status = "rejected";

        addActivity(
            username,
            "User Rejected",
            "Registration request rejected by admin."
        );

        res.json({
            success: true,
            message:
                "User rejected successfully."
        });
    }
);

// ========================================
// LOGOUT
// ========================================

app.post(
    "/logout",
    requireLogin,
    (req, res) => {

        const username =
            req.session.user.username;

        addActivity(
            username,
            "User Logout",
            "User logged out."
        );

        req.session.destroy(error => {

            if (error) {

                console.error(
                    "LOGOUT ERROR:",
                    error
                );

                return res.status(500).json({
                    success: false
                });
            }

            res.json({
                success: true
            });
        });
    }
);

// ========================================
// UPLOAD FILE
// ========================================

app.post(
    "/upload",
    requireLogin,
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Please select a file."
                });
            }

            const command =
                new PutObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: req.file.originalname,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                });

            await s3.send(command);

            addActivity(
                req.session.user.username,
                "File Uploaded",
                req.file.originalname
            );

            res.json({
                success: true,
                message:
                    "File uploaded successfully."
            });

        } catch (error) {

            console.error(
                "UPLOAD ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "File upload failed."
            });
        }
    }
);

// ========================================
// LIST FILES
// ========================================

app.get(
    "/files",
    requireLogin,
    async (req, res) => {

        try {

            const command =
                new ListObjectsV2Command({
                    Bucket: BUCKET_NAME
                });

            const result =
                await s3.send(command);

            const files =
                (result.Contents || [])
                    .map(file => ({
                        name: file.Key,
                        size: file.Size,
                        lastModified:
                            file.LastModified
                    }));

            res.json(files);

        } catch (error) {

            console.error(
                "LIST FILES ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load files."
            });
        }
    }
);

// ========================================
// DOWNLOAD FILE
// ========================================

app.get(
    "/download/:filename",
    requireLogin,
    async (req, res) => {

        try {

            const filename =
                req.params.filename;

            const command =
                new GetObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: filename
                });

            const result =
                await s3.send(command);

            addActivity(
                req.session.user.username,
                "File Downloaded",
                filename
            );

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

        } catch (error) {

            console.error(
                "DOWNLOAD ERROR:",
                error
            );

            res.status(500).send(
                "Unable to download file."
            );
        }
    }
);

// ========================================
// DELETE FILE
// ========================================

app.delete(
    "/delete/:filename",
    requireLogin,
    async (req, res) => {

        try {

            const filename =
                req.params.filename;

            const command =
                new DeleteObjectCommand({
                    Bucket: BUCKET_NAME,
                    Key: filename
                });

            await s3.send(command);

            addActivity(
                req.session.user.username,
                "File Deleted",
                filename
            );

            res.json({
                success: true,
                message:
                    "File deleted successfully."
            });

        } catch (error) {

            console.error(
                "DELETE ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete file."
            });
        }
    }
);

// ========================================
// ACTIVITY
// ========================================

app.get(
    "/activity",
    requireLogin,
    (req, res) => {

        const currentUser =
            req.session.user;

        // ADMIN
        if (
            currentUser.role === "admin"
        ) {

            return res.json(
                activities
            );
        }

        // NORMAL USER
        const userActivities =
            activities.filter(
                activity => {

                    if (
                        activity.username !==
                        currentUser.username
                    ) {
                        return false;
                    }

                    return [
                        "User Login",
                        "File Uploaded",
                        "File Downloaded",
                        "File Deleted"
                    ].includes(
                        activity.action
                    );
                }
            );

        res.json(
            userActivities
        );
    }
);

// ========================================
// STATIC FILES
// ========================================

app.use(
    express.static(__dirname)
);

// ========================================
// HOME
// ========================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );
});

// ========================================
// SERVER
// ========================================

console.log(
    "BEFORE APP.LISTEN"
);

const server = app.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `Secure Cloud Access running at http://${HOST}:${PORT}`
        );

        console.log(
            "SERVER IS ACTUALLY LISTENING."
        );
    }
);

server.on("error", error => {

    console.error(
        "SERVER ERROR:",
        error
    );
});