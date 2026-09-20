const express = require("express");
const session = require("express-session");
const multer = require("multer");
const path = require("path");

const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");

const app = express();

/* =========================
   RENDER PROXY FIX
========================= */

app.set("trust proxy", 1);

/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

const AWS_REGION = process.env.AWS_REGION || "eu-north-1";
const BUCKET_NAME =
  process.env.S3_BUCKET || "prm-secure-cloud-storage";

const IS_PRODUCTION =
  process.env.RENDER === "true" ||
  process.env.NODE_ENV === "production";

/* =========================
   AWS S3
========================= */

const s3 = new S3Client({
  region: AWS_REGION
});

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "secure-cloud-access-project-session-secret",

    resave: false,

    saveUninitialized: false,

    proxy: true,

    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

/* =========================
   FILE UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

/* =========================
   USERS
========================= */

const users = [
  {
    id: 1,
    username: "project-admin",

    // If you already use another password locally,
    // change ONLY this value locally.
    password:
      process.env.ADMIN_PASSWORD || "Secure@123",

    role: "admin",
    status: "approved"
  }
];

/* =========================
   ACTIVITIES
========================= */

const activities = [];

/* =========================
   HELPERS
========================= */

function addActivity(username, action, details = "") {
  activities.unshift({
    id: Date.now(),
    username,
    action,
    details,
    time: new Date().toISOString()
  });

  // Keep memory under control
  if (activities.length > 500) {
    activities.pop();
  }
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      loggedIn: false,
      message: "Please login first."
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      loggedIn: false,
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

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   REGISTER PAGE
========================= */

app.get("/register.html", (req, res) => {
  res.sendFile(path.join(__dirname, "register.html"));
});

/* =========================
   DASHBOARD
========================= */

app.get("/dashboard.html", requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

/* =========================
   REGISTER
========================= */

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required."
    });
  }

  const existingUser = users.find(
    (user) =>
      user.username.toLowerCase() === username.toLowerCase()
  );

  if (existingUser) {
    return res.status(409).json({
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

  res.json({
    success: true,
    message:
      "Registration submitted. Please wait for admin approval."
  });
});

/* =========================
   LOGIN
========================= */

app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  console.log("LOGIN REQUEST");

  const user = users.find(
    (u) =>
      u.username.toLowerCase() === username.toLowerCase() &&
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

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  console.log("SESSION CREATED:", req.session.user);

  addActivity(
    user.username,
    "Login",
    "User logged into Secure Cloud Access"
  );

  /*
    IMPORTANT:
    Save the session BEFORE sending the response.
    This prevents Render from redirecting before
    the session cookie is stored.
  */

  req.session.save((err) => {
    if (err) {
      console.error("SESSION SAVE ERROR:", err);

      return res.status(500).json({
        success: false,
        message: "Unable to create login session."
      });
    }

    return res.json({
      success: true,
      loggedIn: true,
      user: {
        username: user.username,
        role: user.role
      },

      username: user.username,
      role: user.role,

      redirect: "/dashboard.html"
    });
  });
});

/* =========================
   CURRENT USER
========================= */

app.get("/current-user", (req, res) => {
  console.log(
    "CURRENT USER SESSION:",
    req.session.user
  );

  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      loggedIn: false,
      message: "Please login first."
    });
  }

  res.json({
    success: true,
    loggedIn: true,

    user: {
      username: req.session.user.username,
      role: req.session.user.role
    },

    username: req.session.user.username,
    role: req.session.user.role
  });
});

/* =========================
   LOGOUT
========================= */

app.get("/logout", (req, res) => {
  const username = req.session?.user?.username;

  if (username) {
    addActivity(
      username,
      "Logout",
      "User logged out"
    );
  }

  req.session.destroy((err) => {
    if (err) {
      console.error("LOGOUT ERROR:", err);

      return res.status(500).json({
        success: false,
        message: "Logout failed."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax"
    });

    res.redirect("/");
  });
});

app.get("/logout/", (req, res) => {
  const username = req.session?.user?.username;

  if (username) {
    addActivity(
      username,
      "Logout",
      "User logged out"
    );
  }

  req.session.destroy(() => {
    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax"
    });

    res.redirect("/");
  });
});

app.post("/logout", (req, res) => {
  const username = req.session?.user?.username;

  if (username) {
    addActivity(
      username,
      "Logout",
      "User logged out"
    );
  }

  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Logout failed."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax"
    });

    res.json({
      success: true
    });
  });
});

/* =========================
   ADMIN - USERS
========================= */

app.get(
  "/admin/users",
  requireAdmin,
  (req, res) => {
    const safeUsers = users.map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status
    }));

    res.json({
      success: true,
      users: safeUsers
    });
  }
);

/* =========================
   ADMIN - APPROVE
========================= */

app.post(
  "/admin/approve/:id",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    const user = users.find(
      (u) => u.id === id
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    user.status = "approved";

    addActivity(
      req.session.user.username,
      "User Approved",
      `Approved user: ${user.username}`
    );

    res.json({
      success: true,
      message: "User approved successfully."
    });
  }
);

/* =========================
   ADMIN - REJECT
========================= */

app.post(
  "/admin/reject/:id",
  requireAdmin,
  (req, res) => {
    const id = Number(req.params.id);

    const user = users.find(
      (u) => u.id === id
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found."
      });
    }

    user.status = "rejected";

    addActivity(
      req.session.user.username,
      "User Rejected",
      `Rejected user: ${user.username}`
    );

    res.json({
      success: true,
      message: "User rejected successfully."
    });
  }
);

/* =========================
   UPLOAD TO S3
========================= */

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
        `users/${username}/${req.file.originalname}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: req.file.buffer,
          ContentType:
            req.file.mimetype ||
            "application/octet-stream"
        })
      );

      addActivity(
        username,
        "Upload",
        req.file.originalname
      );

      res.json({
        success: true,
        message: "File uploaded successfully.",
        file: req.file.originalname
      });
    } catch (error) {
      console.error("UPLOAD ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Upload failed.",
        error: error.message
      });
    }
  }
);

/* =========================
   LIST FILES
========================= */

app.get(
  "/files",
  requireLogin,
  async (req, res) => {
    try {
      const username =
        req.session.user.username;

      const isAdmin =
        req.session.user.role === "admin";

      const prefix = isAdmin
        ? "users/"
        : `users/${username}/`;

      const result = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: prefix
        })
      );

      const files = (result.Contents || [])
        .filter((item) => item.Key)
        .map((item) => ({
          key: item.Key,
          name: item.Key.split("/").pop(),
          size: item.Size || 0,
          lastModified:
            item.LastModified || null
        }));

      res.json({
        success: true,
        files
      });
    } catch (error) {
      console.error("FILES ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Unable to load files.",
        error: error.message
      });
    }
  }
);

/* =========================
   DOWNLOAD
========================= */

app.get(
  "/download",
  requireLogin,
  async (req, res) => {
    try {
      const key = String(
        req.query.key || ""
      );

      if (!key) {
        return res.status(400).json({
          success: false,
          message: "File key required."
        });
      }

      const username =
        req.session.user.username;

      const isAdmin =
        req.session.user.role === "admin";

      if (
        !isAdmin &&
        !key.startsWith(`users/${username}/`)
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const result = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key
        })
      );

      const filename =
        key.split("/").pop();

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

      addActivity(
        username,
        "Download",
        filename
      );
    } catch (error) {
      console.error("DOWNLOAD ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Download failed.",
        error: error.message
      });
    }
  }
);

/* =========================
   DELETE
========================= */

app.delete(
  "/delete",
  requireLogin,
  async (req, res) => {
    try {
      const key = String(
        req.query.key || ""
      );

      if (!key) {
        return res.status(400).json({
          success: false,
          message: "File key required."
        });
      }

      const username =
        req.session.user.username;

      const isAdmin =
        req.session.user.role === "admin";

      if (
        !isAdmin &&
        !key.startsWith(`users/${username}/`)
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key
        })
      );

      const filename =
        key.split("/").pop();

      addActivity(
        username,
        "Delete",
        filename
      );

      res.json({
        success: true,
        message: "File deleted successfully."
      });
    } catch (error) {
      console.error("DELETE ERROR:", error);

      res.status(500).json({
        success: false,
        message: "Delete failed.",
        error: error.message
      });
    }
  }
);

/* =========================
   ACTIVITY
========================= */

app.get(
  "/activity",
  requireLogin,
  (req, res) => {
    const username =
      req.session.user.username;

    const isAdmin =
      req.session.user.role === "admin";

    let result;

    if (isAdmin) {
      result = activities;
    } else {
      result = activities.filter(
        (item) =>
          item.username === username
      );
    }

    res.json({
      success: true,
      activities: result
    });
  }
);

/* =========================
   STATIC FILES
========================= */

app.use(
  express.static(__dirname)
);

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found."
  });
});

/* =========================
   SERVER
========================= */

app.listen(PORT, HOST, () => {
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
});