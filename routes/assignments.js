const express = require("express");
const { body, validationResult } = require("express-validator");
const Assignment = require("../models/Assignment");
const Course = require("../models/Course");
const { auth, authorize, checkApproval } = require("../middleware/auth");

const router = express.Router();

// Utility function to randomize array order (Fisher-Yates shuffle algorithm)
const shuffleArray = (array) => {
  const shuffled = [...array]; // Create a copy to avoid mutating original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// @route   GET /api/assignments
// @desc    Get assignments for current user(Student)
// @access  Private
router.get("/", auth, async (req, res) => {
  try {
    let assignments;

    if (req.user.role === "student") {
      // Get assignments from enrolled courses
      const Enrollment = require("../models/Enrollment"); // Fixed: Move require inside function
      const enrollments = await Enrollment.find({
        student: req.user._id,
        status: "enrolled",
      }).populate("course");

      const courseIds = enrollments.map((enrollment) => enrollment.course._id);

      assignments = await Assignment.find({
        course: { $in: courseIds },
        isPublished: true,
      })
        .populate("course", "title courseCode")
        .populate("instructor", "firstName lastName")
        .sort({ dueDate: 1 });
    } else {
      // Instructors get their own assignments
      assignments = await Assignment.find({ instructor: req.user._id })
        .populate("course", "title courseCode")
        .sort({ dueDate: 1 });
    }

    res.json(assignments);
  } catch (error) {
    console.error("Get assignments error:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching assignments" });
  }
});

// @route   POST /api/assignments
// @desc    Create a new assignment
// @access  Private (Instructor only)
router.post(
  "/",
  [
    auth,
    authorize("instructor", "admin"),
    checkApproval,
    body("title").trim().notEmpty().withMessage("Assignment title is required"),
    body("description")
      .trim()
      .notEmpty()
      .withMessage("Assignment description is required"),
    body("courseId").notEmpty().withMessage("Course ID is required"),
    body("type")
      .isIn(["homework", "quiz", "exam", "project", "presentation"])
      .withMessage("Invalid assignment type"),
    body("totalPoints")
      .isInt({ min: 1 })
      .withMessage("Total points must be at least 1"),
    body("dueDate")
      .isISO8601()
      .withMessage("Valid due date is required")
      .custom((value) => {
        const dueDate = new Date(value);
        if (isNaN(dueDate.getTime())) {
          throw new Error("Invalid date format");
        }
        const now = new Date();
        if (dueDate <= now) {
          throw new Error("Due date must be in the future");
        }
        return true;
      }),
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
        title,
        description,
        instructions,
        courseId,
        type,
        totalPoints,
        dueDate,
        isPublished,
        allowLateSubmission,
        latePenalty,
        publishDate,
        rubric,
        quizSettings,
        questions,
        submissionType,
        allowedFileTypes,
        maxFileSize,
      } = req.body;

      console.log("Assignment creation request received:", req.body); // Debug log

      // Verify course exists and instructor owns it
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ message: "Course not found" });
      }

      if (
        req.user.role !== "instructor" ||
        course.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({
          message: "Not authorized to create assignments for this course",
        });
      }

      // Ensure dueDate is properly formatted and valid
      const parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({ message: "Invalid due date format" });
      }

      console.log(
        "Creating assignment with due date:",
        parsedDueDate.toISOString()
      ); // Debug log

      const assignmentData = {
        title,
        description,
        course: courseId,
        instructor: req.user._id,
        type,
        totalPoints,
        dueDate: parsedDueDate,
        isPublished: isPublished || false,
        allowLateSubmission:
          allowLateSubmission !== undefined ? allowLateSubmission : true,
        latePenalty: latePenalty || 0,
      };

      // Add instructions if provided
      if (instructions) {
        assignmentData.instructions = instructions;
      }

      // Add optional fields if provided
      if (publishDate) {
        assignmentData.publishDate = new Date(publishDate);
      }

      if (rubric && Array.isArray(rubric)) {
        assignmentData.rubric = rubric;
      }

      if (quizSettings) {
        assignmentData.quizSettings = quizSettings;
      }

      if (questions && Array.isArray(questions)) {
        assignmentData.questions = questions;
      }

      if (submissionType) {
        assignmentData.submissionType = submissionType;
      }

      if (allowedFileTypes && Array.isArray(allowedFileTypes)) {
        assignmentData.allowedFileTypes = allowedFileTypes;
      }

      if (maxFileSize !== undefined) {
        assignmentData.maxFileSize = maxFileSize;
      }

      const assignment = new Assignment(assignmentData);

      await assignment.save();

      await assignment.populate([
        { path: "course", select: "title courseCode" },
        { path: "instructor", select: "firstName lastName" },
      ]);

      // If assignment is published, notify enrolled students
      if (isPublished) {
        const Enrollment = require("../models/Enrollment");
        const Notification = require("../models/Notification");

        const enrolledStudents = await Enrollment.find({
          course: courseId,
          status: "enrolled",
        }).populate("student");

        // Create notifications for all enrolled students
        const notificationPromises = enrolledStudents.map((enrollment) =>
          Notification.createNotification({
            recipient: enrollment.student._id,
            title: "New Assignment Available",
            message: `A new assignment "${title}" has been posted in ${
              course.title
            }. Due: ${parsedDueDate.toLocaleDateString()}`,
            type: "assignment",
            targetId: assignment._id,
            targetUrl: `/assignments/${assignment._id}`,
            actionRequired: true,
          })
        );

        await Promise.all(notificationPromises);
      }

      res.status(201).json({
        message: "Assignment created successfully",
        assignment,
      });
    } catch (error) {
      console.error("Create assignment error:", error);
      res
        .status(500)
        .json({ message: "Server error while creating assignment" });
    }
  }
);

// @route   GET /api/assignments/course/:courseId
// @desc    Get assignments for a course
// @access  Private
router.get("/course/:courseId", auth, async (req, res) => {
  try {
    const assignments = await Assignment.find({
      course: req.params.courseId,
      isPublished: true,
    })
      .populate("instructor", "firstName lastName")
      .sort({ dueDate: 1 });

    res.json(assignments);
  } catch (error) {
    console.error("Get assignments error:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching assignments" });
  }
});

// @route   GET /api/assignments/:id
// @desc    Get single assignment
// @access  Private
router.get("/:id", auth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate("course", "title courseCode")
      .populate("instructor", "firstName lastName");

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    res.json(assignment);
  } catch (error) {
    console.error("Get assignment error:", error);
    res.status(500).json({ message: "Server error while fetching assignment" });
  }
});

// @route   PUT /api/assignments/:id
// @desc    Update assignment
// @access  Private (Instructor only)
router.put(
  "/:id",
  [auth, authorize("instructor", "admin"), checkApproval],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Prepare update data - accept any fields from request body
      const updateData = { ...req.body };

      // Remove fields that should not be updated directly
      delete updateData.instructor; // Instructor cannot be changed
      delete updateData.course; // Course cannot be changed
      delete updateData._id;
      delete updateData.__v;
      delete updateData.createdAt;

      // Handle date fields properly
      if (updateData.dueDate) {
        updateData.dueDate = new Date(updateData.dueDate);
      }
      if (updateData.publishDate) {
        updateData.publishDate = new Date(updateData.publishDate);
      }

      const updatedAssignment = await Assignment.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      ).populate([
        { path: "course", select: "title courseCode" },
        { path: "instructor", select: "firstName lastName" },
      ]);

      res.json({
        message: "Assignment updated successfully",
        assignment: updatedAssignment,
      });
    } catch (error) {
      console.error("Update assignment error:", error);
      res
        .status(500)
        .json({ message: "Server error while updating assignment" });
    }
  }
);

// @route   POST /api/assignments/:id/questions
// @desc    Add a question to an assignment
// @access  Private (Instructor only)
router.post(
  "/:id/questions",
  [
    auth,
    authorize("instructor", "admin"),
    checkApproval,
    body("questionText")
      .trim()
      .notEmpty()
      .withMessage("Question text is required"),
    body("type")
      .isIn(["multiple-choice", "written"])
      .withMessage("Invalid question type"),
    body("points")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Points must be at least 1"),
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

      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const {
        questionText,
        type,
        options,
        correctOption,
        expectedAnswer,
        points,
        explanation,
        difficulty,
        tags,
      } = req.body;

      // Validate MCQ-specific fields
      if (type === "multiple-choice") {
        if (!options || !Array.isArray(options) || options.length < 2) {
          return res
            .status(400)
            .json({ message: "MCQ questions must have at least 2 options" });
        }
        if (
          correctOption === undefined ||
          correctOption < 0 ||
          correctOption >= options.length
        ) {
          return res
            .status(400)
            .json({ message: "Invalid correct option index" });
        }
      }

      // Validate written question fields
      if (type === "written" && !expectedAnswer) {
        return res
          .status(400)
          .json({ message: "Written questions must have an expected answer" });
      }

      const newQuestion = {
        questionText,
        type,
        points: points || 1,
        explanation,
        difficulty: difficulty || "easy",
        tags: tags || [],
      };

      if (type === "multiple-choice") {
        newQuestion.options = options;
        newQuestion.correctOption = correctOption;
      } else {
        newQuestion.expectedAnswer = expectedAnswer;
      }

      assignment.questions.push(newQuestion);
      await assignment.save();

      res.status(201).json({
        message: "Question added successfully",
        question: assignment.questions[assignment.questions.length - 1],
      });
    } catch (error) {
      console.error("Add question error:", error);
      res.status(500).json({ message: "Server error while adding question" });
    }
  }
);

// @route   GET /api/assignments/:id/questions
// @desc    Get all questions from an assignment (with randomization if enabled)
// @access  Private (Student only)
router.get(
  "/:id/questions",
  [auth, authorize("student")],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Get all questions from the assignment
      let questions = assignment.questions;

      if (!questions || questions.length === 0) {
        return res.status(404).json({ message: "No questions found for this assignment" });
      }

      // Check if question randomization is enabled in quiz settings
      if (assignment.quizSettings && assignment.quizSettings.randomizeQuestions) {
        questions = shuffleArray(questions);
      }

      res.json({
        message: "Questions retrieved successfully",
        questions,
        randomized: assignment.quizSettings?.randomizeQuestions || false, // Indicate if questions were randomized
      });
    } catch (error) {
      console.error("Get questions error:", error);
      res.status(500).json({ message: "Server error while fetching questions" });
    }
  }
);

// @route   DELETE /api/assignments/:id/questions/:questionId
// @desc    Delete a specific question from an assignment
// @access  Private (Instructor only)
router.delete(
  "/:id/questions/:questionId",
  [auth, authorize("instructor", "admin"), checkApproval],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const question = assignment.questions.id(req.params.questionId);

      if (!question) {
        return res.status(404).json({ message: "Question not found" });
      }

      question.deleteOne();
      await assignment.save();

      res.json({ message: "Question deleted successfully" });
    } catch (error) {
      console.error("Delete question error:", error);
      res.status(500).json({ message: "Server error while deleting question" });
    }
  }
);

// @route   PUT /api/assignments/:id/rubric
// @desc    Update assignment rubric
// @access  Private (Instructor only)
router.put(
  "/:id/rubric",
  [
    auth,
    authorize("instructor", "admin"),
    checkApproval,
    body("rubric").isArray().withMessage("Rubric must be an array"),
    body("rubric.*.criterion")
      .trim()
      .notEmpty()
      .withMessage("Criterion name is required"),
    body("rubric.*.value")
      .isNumeric()
      .withMessage("Criterion value must be a number"),
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

      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      assignment.rubric = req.body.rubric;
      await assignment.save();

      res.json({
        message: "Rubric updated successfully",
        rubric: assignment.rubric,
      });
    } catch (error) {
      console.error("Update rubric error:", error);
      res.status(500).json({ message: "Server error while updating rubric" });
    }
  }
);

// @route   PUT /api/assignments/:id/quiz-settings
// @desc    Update quiz settings for an assignment
// @access  Private (Instructor only)
router.put(
  "/:id/quiz-settings",
  [auth, authorize("instructor", "admin"), checkApproval],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { randomizeQuestions, timeLimit, maxAttempts, autoGrade } =
        req.body;

      if (!assignment.quizSettings) {
        assignment.quizSettings = {};
      }

      if (randomizeQuestions !== undefined)
        assignment.quizSettings.randomizeQuestions = randomizeQuestions;
      if (timeLimit !== undefined)
        assignment.quizSettings.timeLimit = timeLimit;
      if (maxAttempts !== undefined)
        assignment.quizSettings.maxAttempts = maxAttempts;
      if (autoGrade !== undefined)
        assignment.quizSettings.autoGrade = autoGrade;

      await assignment.save();

      res.json({
        message: "Quiz settings updated successfully",
        quizSettings: assignment.quizSettings,
      });
    } catch (error) {
      console.error("Update quiz settings error:", error);
      res
        .status(500)
        .json({ message: "Server error while updating quiz settings" });
    }
  }
);

// @route   DELETE /api/assignments/:id
// @desc    Delete assignment
// @access  Private (Instructor only)
router.delete(
  "/:id",
  [auth, authorize("instructor", "admin"), checkApproval],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      await Assignment.findByIdAndDelete(req.params.id);

      res.json({ message: "Assignment deleted successfully" });
    } catch (error) {
      console.error("Delete assignment error:", error);
      res
        .status(500)
        .json({ message: "Server error while deleting assignment" });
    }
  }
);

module.exports = router;
