const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const { auth, authorize } = require("../middleware/auth");
const { uploadDocuments } = require("../middleware/upload");
const { sendPasswordResetEmail } = require("../utils/email");

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post(
  "/register",
  [
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role").isIn(["student", "instructor"]).withMessage("Invalid role"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const {
        firstName,
        lastName,
        email,
        password,
        role,
        phone,
        dateOfBirth,
        instructorProfile,
      } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res
          .status(400)
          .json({ message: "User already exists with this email" });
      }

      // Create new user
      const userData = {
        firstName,
        lastName,
        email,
        password,
        role,
        phone,
        dateOfBirth,
      };

      // Add instructor profile if role is instructor
      if (role === "instructor" && instructorProfile) {
        userData.instructorProfile = {
          qualification: instructorProfile.qualification,
          experience: instructorProfile.experience || 0,
          specialization: instructorProfile.specialization || [],
          bio: instructorProfile.bio,
          linkedIn: instructorProfile.linkedIn,
          portfolio: instructorProfile.portfolio,
          documents: [], // Will be added via document upload endpoint
          documentsUploaded: false,
          verificationStatus: "pending",
        };
      } else if (role === "instructor") {
        // Initialize empty instructor profile for instructors
        userData.instructorProfile = {
          documents: [],
          documentsUploaded: false,
          verificationStatus: "pending",
        };
      }

      const user = new User(userData);
      await user.save();

      // If instructor, create notification for admins
      if (role === "instructor") {
        const Notification = require("../models/Notification");
        await Notification.notifyAdmins(
          "New Instructor Registration",
          `${firstName} ${lastName} (${email}) has registered as an instructor and requires document verification.`,
          "system",
          {
            targetId: user._id,
            targetUrl: `/admin/instructor-verification`,
            actionRequired: true,
          }
        );
      }

      // Generate token
      const token = generateToken(user._id);

      const message =
        role === "instructor"
          ? "Registration successful! Please upload your documents for verification."
          : "Registration successful!";

      res.status(201).json({
        message,
        token,
        user: user.getPublicProfile(),
        requiresApproval: role === "instructor",
        needsDocuments: role === "instructor",
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Server error during registration" });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post(
  "/login",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Check if account is active
      if (!user.isActive) {
        return res.status(400).json({ message: "Account is deactivated" });
      }

      // Verify password
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate token
      const token = generateToken(user._id);

      res.json({
        message: "Login successful",
        token,
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Server error during login" });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get("/me", auth, async (req, res) => {
  try {
    res.json({ user: req.user.getPublicProfile() });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put(
  "/profile",
  auth,
  [
    body("firstName")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("First name cannot be empty"),
    body("lastName")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Last name cannot be empty"),
    body("phone").optional().trim(),
    body("dateOfBirth")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const allowedUpdates = [
        "firstName",
        "lastName",
        "phone",
        "dateOfBirth",
        "address",
      ];
      const updates = {};

      Object.keys(req.body).forEach((key) => {
        if (allowedUpdates.includes(key)) {
          updates[key] = req.body[key];
        }
      });

      const user = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
        runValidators: true,
      });

      res.json({
        message: "Profile updated successfully",
        user: user.getPublicProfile(),
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({ message: "Server error during profile update" });
    }
  }
);

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put(
  "/change-password",
  auth,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { currentPassword, newPassword } = req.body;

      // Get user with password
      const user = await User.findById(req.user._id);

      // Verify current password
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });
      }

      // Update password
      user.password = newPassword;
      await user.save();

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Server error during password change" });
    }
  }
);

// @route   PUT /api/auth/reset-password
// @desc    Reset user password
// @access  Private

// @route   POST /api/auth/request-password-reset
// @desc    Request password reset (verify email and send reset token)
// @access  Public
router.post(
  "/request-password-reset",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { email } = req.body;

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if user exists or not for security
        return res.status(200).json({
          message: "If the email exists, a password reset token has been generated.",
        });
      }

      // Check if account is active
      if (!user.isActive) {
        return res.status(400).json({ message: "Account is deactivated" });
      }

      // Generate reset token (random 6-digit code or you can use crypto for more security)
      const crypto = require("crypto");
      const resetToken = crypto.randomBytes(32).toString("hex");
      
      // Hash the token before storing
      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      // Set token and expiration (1 hour from now)
      user.passwordResetToken = hashedToken;
      user.passwordResetExpires = Date.now() + 3600000; // 1 hour
      await user.save();

      // Send password reset email
      try {
        await sendPasswordResetEmail(
          user.email,
          resetToken,
          `${user.firstName} ${user.lastName}`
        );
        
        res.json({
          message: "Password reset link has been sent to your email address.",
          email: user.email,
        });
      } catch (emailError) {
        console.error("Failed to send email:", emailError);
        // Still return success but inform about email issue
        res.json({
          message: "Password reset token generated, but email could not be sent. Please contact support.",
          resetToken, // Fallback: provide token in response if email fails
        });
      }
    } catch (error) {
      console.error("Password reset request error:", error);
      res.status(500).json({ message: "Server error during password reset request" });
    }
  }
);

// @route   PUT /api/auth/reset-password
// @desc    Reset password using token
// @access  Public
router.put(
  "/reset-password",
  [
    body("resetToken").notEmpty().withMessage("Reset token is required"),
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("New password must be at least 8 characters"),
    body("confirmPassword")
      .notEmpty()
      .withMessage("Password confirmation is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation errors",
          errors: errors.array(),
        });
      }

      const { resetToken, newPassword, confirmPassword } = req.body;

      // Check if passwords match
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ 
          message: "Passwords do not match" 
        });
      }

      // Hash the token from request to compare with stored hashed token
      const crypto = require("crypto");
      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      // Find user with valid reset token and not expired
      const user = await User.findOne({
        passwordResetToken: hashedToken,
        passwordResetExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res.status(400).json({ 
          message: "Invalid or expired reset token" 
        });
      }

      // Update password (will be hashed by pre-save middleware)
      user.password = newPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      res.json({ 
        message: "Password has been reset successfully. You can now login with your new password." 
      });
    } catch (error) {
      console.error("Password reset error:", error);
      res.status(500).json({ message: "Server error during password reset" });
    }
  }
);

// @route   PUT /api/auth/confirm-email
// @desc    Confirm user email if is valid
// @access  Private

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post("/logout", auth, (req, res) => {
  res.json({ message: "Logged out successfully" });
});

// @route   POST /api/auth/upload-documents
// @desc    Upload instructor documents
// @access  Private (Instructor only)
router.post(
  "/upload-documents",
  [auth, authorize("instructor")],
  (req, res) => {
    uploadDocuments(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message });
      }

      try {
        const { documentTypes } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
          return res.status(400).json({ message: "No documents uploaded" });
        }

        const user = await User.findById(req.user._id);
        if (!user.instructorProfile) {
          user.instructorProfile = { documents: [] };
        }

        // Process uploaded documents
        const documents = files.map((file, index) => ({
          type: JSON.parse(documentTypes)[index] || "other",
          originalName: file.originalname,
          filename: file.filename,
          path: file.path,
          mimetype: file.mimetype,
          size: file.size,
        }));

        user.instructorProfile.documents.push(...documents);
        user.instructorProfile.documentsUploaded = true;
        user.instructorProfile.verificationStatus = "under_review";
        await user.save();

        // Notify admins about document upload
        const Notification = require("../models/Notification");
        await Notification.notifyAdmins(
          "Instructor Documents Uploaded",
          `${user.firstName} ${user.lastName} has uploaded ${files.length} document(s) for verification.`,
          "system",
          {
            targetId: user._id,
            targetUrl: `/admin/instructor-verification`,
            actionRequired: true,
          }
        );

        res.json({
          message: "Documents uploaded successfully",
          documents: documents.length,
          status: "under_review",
          verificationStatus: user.instructorProfile.verificationStatus,
          documentsUploaded: user.instructorProfile.documentsUploaded,
        });
      } catch (error) {
        console.error("Document upload error:", error);
        res
          .status(500)
          .json({ message: "Server error while uploading documents" });
      }
    });
  }
);

module.exports = router;
