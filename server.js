const express = require("express");
const path = require("path");
const session = require("express-session");
const multer = require("multer");

const {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    GetObjectCommand,
    DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const app = express();


// =====================================================
// SERVER
// =====================================================

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const AWS_REGION = "eu-north-1";
const BUCKET_NAME = "prm-secure-cloud-storage";


// =====================================================
// AWS
// =====================================================

const s3 = new S3Client({
    region: AWS_REGION
});


// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


// =====================================================
// SESSION
// =====================================================

app.use(
    session({

        secret:
            process.env.SESSION_SECRET ||
            "secure-cloud-access-session",

        resave: false,

        saveUninitialized: false,

        proxy: true,

        cookie: {

            httpOnly: true,

            // LOCAL HTTP = false
            // RENDER HTTPS = true
            secure:
                process.env.RENDER === "true",

            sameSite: "lax",

            maxAge:
                24 * 60 * 60 * 1000
        }
    })
);


// =====================================================
// MULTER
// =====================================================

const upload =
    multer({
        storage:
            multer.memoryStorage()
    });


// =====================================================
// USERS
// =====================================================

let users = [

    {
        id: 1,
        username: "project-admin",
        password: "Secure@123",
        role: "admin",
        status: "approved"
    }

];

let nextUserId = 2;


// =====================================================
// ACTIVITIES
// =====================================================

let activities = [];


// =====================================================
// ACTIVITY HELPER
// =====================================================

function addActivity(
    username,
    action,
    details = ""
) {

    activities.unshift({

        id: Date.now(),

        username,

        action,

        details,

        time:
            new Date().toISOString()

    });
}


// =====================================================
// REQUIRE LOGIN
// =====================================================

function requireLogin(
    req,
    res,
    next
) {

    if (!req.session.user) {

        return res.status(401).json({

            success: false,

            message:
                "Please login first."

        });
    }

    next();
}


// =====================================================
// REQUIRE ADMIN
// =====================================================

function requireAdmin(
    req,
    res,
    next
) {

    if (!req.session.user) {

        return res.status(401).json({

            success: false,

            message:
                "Please login first."

        });
    }

    if (
        req.session.user.role !==
        "admin"
    ) {

        return res.status(403).json({

            success: false,

            message:
                "Admin access required."

        });
    }

    next();
}


// =====================================================
// HOME
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "index.html"
            )
        );
    }
);


// =====================================================
// REGISTER PAGE
// =====================================================

app.get(
    "/register.html",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "register.html"
            )
        );
    }
);

app.get(
    "/register.html/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "register.html"
            )
        );
    }
);


// =====================================================
// DASHBOARD PAGE
// =====================================================

app.get(
    "/dashboard.html",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "dashboard.html"
            )
        );
    }
);


// =====================================================
// REGISTER
// =====================================================

app.post(
    "/register",
    (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username and password are required."

                });
            }

            const cleanUsername =
                username.trim();

            if (
                cleanUsername.length < 3
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username must contain at least 3 characters."

                });
            }

            const existingUser =
                users.find(
                    user =>
                        user.username
                            .toLowerCase() ===
                        cleanUsername
                            .toLowerCase()
                );

            if (existingUser) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username already exists."

                });
            }

            const newUser = {

                id:
                    nextUserId++,

                username:
                    cleanUsername,

                password,

                role:
                    "user",

                status:
                    "pending"
            };

            users.push(newUser);

            addActivity(
                cleanUsername,
                "REGISTRATION",
                "New user registration submitted for admin approval."
            );

            res.json({

                success: true,

                message:
                    "Registration successful. Please wait for admin approval."
            });

        } catch (error) {

            console.error(
                "Registration error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Registration failed."
            });
        }
    }
);


// =====================================================
// LOGIN
// =====================================================

app.post(
    "/login",
    (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Username and password are required."
                });
            }

            const cleanUsername =
                username.trim();

            const user =
                users.find(
                    item =>
                        item.username ===
                        cleanUsername
                );

            if (!user) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid username or password."
                });
            }

            if (
                user.password !==
                password
            ) {

                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid username or password."
                });
            }

            if (
                user.status !==
                "approved"
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "Your account is waiting for admin approval."
                });
            }


            // Remove old session
            req.session.regenerate(
                (regenerateError) => {

                    if (regenerateError) {

                        console.error(
                            "Session regenerate error:",
                            regenerateError
                        );

                        return res.status(500).json({

                            success: false,

                            message:
                                "Unable to create login session."
                        });
                    }


                    req.session.user = {

                        id:
                            user.id,

                        username:
                            user.username,

                        role:
                            user.role

                    };


                    addActivity(
                        user.username,
                        "LOGIN",
                        "User logged into the system."
                    );


                    req.session.save(
                        (saveError) => {

                            if (saveError) {

                                console.error(
                                    "Session save error:",
                                    saveError
                                );

                                return res.status(500).json({

                                    success: false,

                                    message:
                                        "Unable to create login session."
                                });
                            }


                            return res.json({

                                success: true,

                                message:
                                    "Login successful.",

                                user: {

                                    id:
                                        user.id,

                                    username:
                                        user.username,

                                    role:
                                        user.role
                                }
                            });

                        }
                    );

                }
            );

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Login failed."
            });
        }
    }
);


// =====================================================
// CURRENT USER
// =====================================================

app.get(
    "/current-user",
    (req, res) => {

        if (!req.session.user) {

            return res.status(401).json({

                success: false,

                message:
                    "Not logged in."
            });
        }

        res.json({

            success: true,

            user:
                req.session.user
        });
    }
);


// =====================================================
// LOGOUT
// =====================================================

function logoutUser(
    req,
    res
) {

    const username =
        req.session?.user?.username;


    if (username) {

        addActivity(
            username,
            "LOGOUT",
            "User logged out of the system."
        );
    }


    req.session.destroy(
        (err) => {

            if (err) {

                console.error(
                    "Logout error:",
                    err
                );

                return res.status(500).send(
                    "Logout failed."
                );
            }


            res.clearCookie(
                "connect.sid",
                {
                    httpOnly: true,

                    secure:
                        process.env.RENDER === "true",

                    sameSite: "lax"
                }
            );


            return res.redirect("/");
        }
    );
}


// GET logout
app.get(
    "/logout",
    logoutUser
);


// GET logout with slash
app.get(
    "/logout/",
    logoutUser
);


// POST logout
app.post(
    "/logout",
    logoutUser
);


// =====================================================
// ADMIN USERS
// =====================================================

app.get(
    "/admin/users",
    requireAdmin,
    (req, res) => {

        const safeUsers =
            users.map(
                user => ({

                    id:
                        user.id,

                    username:
                        user.username,

                    role:
                        user.role,

                    status:
                        user.status
                })
            );

        res.json({

            success: true,

            users:
                safeUsers
        });
    }
);


// =====================================================
// ADMIN APPROVE
// =====================================================

app.post(
    "/admin/approve/:id",
    requireAdmin,
    (req, res) => {

        const userId =
            Number(req.params.id);

        const user =
            users.find(
                item =>
                    item.id ===
                    userId
            );

        if (!user) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found."
            });
        }

        user.status =
            "approved";

        addActivity(
            req.session.user.username,
            "APPROVE_USER",
            `Approved user: ${user.username}`
        );

        res.json({

            success: true,

            message:
                "User approved successfully."
        });
    }
);


// =====================================================
// ADMIN REJECT
// =====================================================

app.post(
    "/admin/reject/:id",
    requireAdmin,
    (req, res) => {

        const userId =
            Number(req.params.id);

        const user =
            users.find(
                item =>
                    item.id ===
                    userId
            );

        if (!user) {

            return res.status(404).json({

                success: false,

                message:
                    "User not found."
            });
        }

        user.status =
            "rejected";

        addActivity(
            req.session.user.username,
            "REJECT_USER",
            `Rejected user: ${user.username}`
        );

        res.json({

            success: true,

            message:
                "User rejected successfully."
        });
    }
);


// =====================================================
// S3 UPLOAD
// =====================================================

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
                        "No file selected."
                });
            }

            const username =
                req.session.user.username;


            // USER-SPECIFIC FOLDER
            const key =
                `users/${username}/${Date.now()}-${req.file.originalname}`;


            const command =
                new PutObjectCommand({

                    Bucket:
                        BUCKET_NAME,

                    Key:
                        key,

                    Body:
                        req.file.buffer,

                    ContentType:
                        req.file.mimetype ||
                        "application/octet-stream"
                });


            await s3.send(command);


            addActivity(
                username,
                "UPLOAD",
                `Uploaded file: ${req.file.originalname}`
            );


            res.json({

                success: true,

                message:
                    "File uploaded successfully.",

                key,

                filename:
                    req.file.originalname
            });

        } catch (error) {

            console.error(
                "Upload error:",
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


// =====================================================
// LIST FILES
// =====================================================

app.get(
    "/files",
    requireLogin,
    async (req, res) => {

        try {

            const username =
                req.session.user.username;

            const isAdmin =
                req.session.user.role ===
                "admin";


            // ADMIN = ALL FILES
            // USER = ONLY OWN FOLDER
            const prefix =
                isAdmin
                    ? "users/"
                    : `users/${username}/`;


            const command =
                new ListObjectsV2Command({

                    Bucket:
                        BUCKET_NAME,

                    Prefix:
                        prefix
                });


            const data =
                await s3.send(command);


            const files =
                data.Contents || [];


            const formattedFiles =
                files
                    .filter(
                        file =>
                            file.Key &&
                            file.Key !== prefix
                    )
                    .map(
                        file => ({

                            key:
                                file.Key,

                            name:
                                file.Key
                                    .split("/")
                                    .pop(),

                            size:
                                file.Size,

                            lastModified:
                                file.LastModified
                        })
                    );


            res.json({

                success: true,

                files:
                    formattedFiles
            });

        } catch (error) {

            console.error(
                "List files error:",
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


// =====================================================
// DOWNLOAD
// =====================================================

app.get(
    "/download",
    requireLogin,
    async (req, res) => {

        try {

            const key =
                req.query.key;

            if (!key) {

                return res.status(400).send(
                    "File key is required."
                );
            }


            const username =
                req.session.user.username;

            const isAdmin =
                req.session.user.role ===
                "admin";


            // USER CAN ONLY DOWNLOAD OWN FILE
            if (
                !isAdmin &&
                !key.startsWith(
                    `users/${username}/`
                )
            ) {

                return res.status(403).send(
                    "You do not have permission to access this file."
                );
            }


            const command =
                new GetObjectCommand({

                    Bucket:
                        BUCKET_NAME,

                    Key:
                        key
                });


            const data =
                await s3.send(command);


            const filename =
                key.split("/").pop();


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );


            if (data.ContentType) {

                res.setHeader(
                    "Content-Type",
                    data.ContentType
                );
            }


            data.Body.pipe(res);


            addActivity(
                username,
                "DOWNLOAD",
                `Downloaded file: ${filename}`
            );

        } catch (error) {

            console.error(
                "Download error:",
                error
            );

            res.status(500).send(
                "File download failed."
            );
        }
    }
);


// =====================================================
// DELETE
// =====================================================

app.delete(
    "/delete",
    requireLogin,
    async (req, res) => {

        try {

            const key =
                req.query.key;

            if (!key) {

                return res.status(400).json({

                    success: false,

                    message:
                        "File key is required."
                });
            }


            const username =
                req.session.user.username;

            const isAdmin =
                req.session.user.role ===
                "admin";


            // USER CAN ONLY DELETE OWN FILE
            if (
                !isAdmin &&
                !key.startsWith(
                    `users/${username}/`
                )
            ) {

                return res.status(403).json({

                    success: false,

                    message:
                        "You do not have permission to delete this file."
                });
            }


            const command =
                new DeleteObjectCommand({

                    Bucket:
                        BUCKET_NAME,

                    Key:
                        key
                });


            await s3.send(command);


            const filename =
                key.split("/").pop();


            addActivity(
                username,
                "DELETE",
                `Deleted file: ${filename}`
            );


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

                message:
                    "File deletion failed."
            });
        }
    }
);


// =====================================================
// ACTIVITY
// =====================================================

app.get(
    "/activity",
    requireLogin,
    (req, res) => {

        const username =
            req.session.user.username;

        const isAdmin =
            req.session.user.role ===
            "admin";


        let result =
            isAdmin
                ? activities
                : activities.filter(
                    activity =>
                        activity.username ===
                        username
                );


        res.json({

            success: true,

            activities:
                result
        });
    }
);


// =====================================================
// ADMIN ACTIVITY
// =====================================================

app.get(
    "/admin/activity",
    requireAdmin,
    (req, res) => {

        res.json({

            success: true,

            activities
        });
    }
);


// =====================================================
// ADMIN ACCESS CONTROL
// =====================================================

app.get(
    "/admin/access-control",
    requireAdmin,
    (req, res) => {

        res.json({

            success: true,

            message:
                "Admin access control enabled.",

            role:
                req.session.user.role
        });
    }
);


// =====================================================
// ADMIN SECURITY
// =====================================================

app.get(
    "/admin/security",
    requireAdmin,
    (req, res) => {

        res.json({

            success: true,

            security: {

                authentication:
                    "Session based authentication",

                authorization:
                    "Role based access control",

                storage:
                    "Amazon S3",

                iam:
                    "AWS IAM",

                encryption:
                    "AWS S3 server-side encryption"
            }
        });
    }
);


// =====================================================
// STATIC FILES
// =====================================================

app.use(
    express.static(__dirname)
);


// =====================================================
// 404
// =====================================================

app.use(
    (req, res) => {

        res.status(404).send(
            `Cannot ${req.method} ${req.originalUrl}`
        );
    }
);


// =====================================================
// ERROR HANDLER
// =====================================================

app.use(
    (err, req, res, next) => {

        console.error(
            "Server error:",
            err
        );

        res.status(500).json({

            success: false,

            message:
                "Internal server error."
        });
    }
);


// =====================================================
// START SERVER
// =====================================================

const server =
    app.listen(
        PORT,
        HOST,
        () => {

            console.log(
                `Secure Cloud Access running at http://${HOST}:${PORT}`
            );

            console.log(
                `AWS Region: ${AWS_REGION}`
            );

            console.log(
                `S3 Bucket: ${BUCKET_NAME}`
            );

            console.log(
                "GET /logout route enabled"
            );
        }
    );


server.on(
    "error",
    (error) => {

        console.error(
            "SERVER ERROR:",
            error
        );
    }
);