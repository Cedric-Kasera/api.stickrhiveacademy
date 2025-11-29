const express = require("express");
const { body, validationResult } = require("express-validator");
const Submission = require("../models/Submission");
const Assignment = require("../models/Assignment");
const { auth, authorize } = require("../middleware/auth");

const router = express.Router();

// Utility function to auto-grade multiple-choice quiz submissions
const autoGradeQuiz = (assignment, studentAnswers) => {
  let totalQuestionPoints = 0;
  let earnedQuestionPoints = 0;
  const gradedAnswers = [];

  // Create a map of questions for quick lookup
  const questionsMap = new Map();
  assignment.questions.forEach((q) => {
    questionsMap.set(q._id.toString(), q);
  });

  // Grade each answer
  studentAnswers.forEach((studentAnswer) => {
    const question = questionsMap.get(studentAnswer.questionId);

    if (question && question.type === "multiple-choice") {
      const pointsForQuestion = question.points || 1;
      totalQuestionPoints += pointsForQuestion;

      // Check if answer is correct (null or undefined answers are marked as wrong)
      const isCorrect =
        studentAnswer.answer !== null &&
        studentAnswer.answer !== undefined &&
        studentAnswer.answer === question.correctOption;

      if (isCorrect) {
        earnedQuestionPoints += pointsForQuestion;
      }

      gradedAnswers.push({
        questionId: studentAnswer.questionId,
        studentAnswer: studentAnswer.answer,
        correctAnswer: question.correctOption,
        isCorrect,
        points: pointsForQuestion,
        earnedPoints: isCorrect ? pointsForQuestion : 0,
      });
    }
  });

  // Calculate percentage and scale to assignment's total points
  const percentage = totalQuestionPoints > 0 ? (earnedQuestionPoints / totalQuestionPoints) * 100 : 0;
  
  // Scale earned points to match assignment's totalPoints
  // e.g., if student earned 7/8 question points and assignment has 100 total points
  // then final points = (7/8) * 100 = 87.5
  const scaledEarnedPoints = totalQuestionPoints > 0 
    ? (earnedQuestionPoints / totalQuestionPoints) * assignment.totalPoints 
    : 0;

  return {
    totalPoints: assignment.totalPoints, // Return assignment's total points, not sum of question points
    earnedPoints: scaledEarnedPoints, // Scaled to assignment's total points
    percentage,
    gradedAnswers,
  };
};

// @route   POST /api/submissions/:assignmentId
// @desc    Create a new assignment submission
// @access  Private (Student only)
router.post(
  "/:assignmentId",
  [auth, authorize("student")],
  async (req, res) => {
    try {
      const {
        assignmentType,
        answers,
        submissionText,
        attachments,
        submittedAt,
      } = req.body;
      const { assignmentId } = req.params;

      // Fetch assignment with all details
      const assignment = await Assignment.findById(assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      // Check if submission already exists
      const existingSubmission = await Submission.findOne({
        assignment: assignmentId,
        student: req.user._id,
      });

      if (existingSubmission) {
        return res.status(400).json({
          message:
            "Submission already exists. Use resubmit endpoint to update.",
        });
      }

      // Check if assignment is overdue
      const isLate = assignment.dueDate
        ? new Date() > new Date(assignment.dueDate)
        : false;

      // Initialize submission data
      const submissionData = {
        assignment: assignmentId,
        student: req.user._id,
        isLate,
        status: "submitted",
        submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
      };

      // Handle different assignment types
      if (assignmentType === "quiz" || assignmentType === "exam") {
        // Quiz/Exam submissions should have answers array
        if (!answers || !Array.isArray(answers)) {
          return res.status(400).json({
            message: "Answers array is required for quiz/exam submissions",
          });
        }

        // Create a map of questions for metadata lookup
        const questionsMap = new Map();
        assignment.questions.forEach((q) => {
          questionsMap.set(q._id.toString(), q);
        });

        // Store answers with complete metadata in quizAnswers field
        submissionData.quizAnswers = answers.map((studentAnswer) => {
          const question = questionsMap.get(studentAnswer.questionId);
          
          if (!question) {
            return null; // Skip if question not found
          }

          return {
            questionId: studentAnswer.questionId,
            questionText: question.questionText,
            questionType: question.type,
            options: question.type === 'multiple-choice' ? question.options : undefined,
            studentAnswer: studentAnswer.answer,
            correctAnswer: question.type === 'multiple-choice' 
              ? question.correctOption 
              : question.expectedAnswer,
            points: question.points || 1,
            explanation: question.explanation,
            difficulty: question.difficulty,
            tags: question.tags || []
          };
        }).filter(Boolean); // Remove null entries

        // Check if auto-grading is enabled for multiple-choice questions
        if (assignment.quizSettings && assignment.quizSettings.autoGrade) {
          // Auto-grade the submission
          const gradingResult = autoGradeQuiz(assignment, answers);

          // Update quizAnswers with grading results (isCorrect and earnedPoints)
          submissionData.quizAnswers = submissionData.quizAnswers.map((qa) => {
            const gradedAnswer = gradingResult.gradedAnswers.find(
              (ga) => ga.questionId === qa.questionId.toString()
            );
            
            if (gradedAnswer) {
              qa.isCorrect = gradedAnswer.isCorrect;
              qa.earnedPoints = gradedAnswer.earnedPoints;
            }
            
            return qa;
          });

          // Set grade information
          submissionData.grade = {
            points: gradingResult.earnedPoints,
            percentage: gradingResult.percentage,
            gradedAt: new Date(),
            gradedBy: req.user._id, // System auto-grade (could be a system user ID)
          };

          // Store detailed grading in rubric or a custom field
          submissionData.rubric = gradingResult.gradedAnswers.map((ga) => ({
            criterion: `Question ${ga.questionId}`,
            maxPoints: ga.points,
            earnedPoints: ga.earnedPoints,
            comment: ga.isCorrect
              ? "Correct"
              : `Incorrect. Correct answer: ${ga.correctAnswer}`,
          }));

          submissionData.status = "graded";
        }
      } else {
        // For homework, project, presentation - handle file/text submissions
        if (submissionText) {
          submissionData.submissionText = submissionText;
        }

        if (attachments && Array.isArray(attachments)) {
          submissionData.attachments = attachments;
        }

        // Validate that at least one submission method is provided
        if (!submissionText && (!attachments || attachments.length === 0)) {
          return res.status(400).json({
            message:
              "Either submission text or attachments are required for this assignment type",
          });
        }
      }

      // Create and save submission
      const submission = new Submission(submissionData);
      await submission.save();

      // Populate for response
      await submission.populate([
        {
          path: "assignment",
          select: "title dueDate totalPoints type quizSettings",
        },
        { path: "student", select: "firstName lastName email" },
      ]);

      res.status(201).json({
        message:
          submission.status === "graded"
            ? "Submission created and auto-graded successfully"
            : "Submission created successfully",
        submission,
        autoGraded: submission.status === "graded",
      });
    } catch (error) {
      console.error("Create submission error:", error);
      res
        .status(500)
        .json({ message: "Server error while creating submission" });
    }
  }
);

// @route   GET /api/submissions/assignment/:assignmentId/student/:studentId
// @desc    Get submission for specific assignment and student
// @access  Private
router.get(
  "/assignment/:assignmentId/student/:studentId",
  auth,
  async (req, res) => {
    try {
      const { assignmentId, studentId } = req.params;

      // Students can only view their own submissions
      if (
        req.user.role === "student" &&
        req.user._id.toString() !== studentId
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const submission = await Submission.findOne({
        assignment: assignmentId,
        student: studentId,
      })
        .populate("assignment", "title totalPoints")
        .populate("student", "firstName lastName email");

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      res.json(submission);
    } catch (error) {
      console.error("Get submission error:", error);
      res
        .status(500)
        .json({ message: "Server error while fetching submission" });
    }
  }
);

// @route   GET /api/submissions/assignment/:assignmentId
// @desc    Get all submissions for an assignment
// @access  Private (Instructor only)
router.get(
  "/assignment/:assignmentId",
  [auth, authorize("instructor", "admin")],
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.assignmentId);
      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      const submissions = await Submission.find({
        assignment: req.params.assignmentId,
      })
        .populate("student", "firstName lastName email")
        .sort({ submittedAt: -1 });

      res.json(submissions);
    } catch (error) {
      console.error("Get submissions error:", error);
      res
        .status(500)
        .json({ message: "Server error while fetching submissions" });
    }
  }
);

// @route   PUT /api/submissions/:id/grade
// @desc    Grade a submission
// @access  Private (Instructor only)
router.put(
  "/:id/grade",
  [
    auth,
    authorize("instructor", "admin"),
    body("points")
      .isFloat({ min: 0 })
      .withMessage("Points must be a positive number"),
    body("feedback").optional().trim(),
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

      const submission = await Submission.findById(req.params.id).populate(
        "assignment"
      );

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        submission.assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { points, feedback, rubric } = req.body;
      const percentage = (points / submission.assignment.totalPoints) * 100;

      submission.grade = {
        points,
        percentage,
        gradedAt: new Date(),
        gradedBy: req.user._id,
      };

      if (feedback) submission.feedback = feedback;
      if (rubric && Array.isArray(rubric)) submission.rubric = rubric;
      submission.status = "graded";

      await submission.save();

      // Populate grader info for response
      await submission.populate("grade.gradedBy", "firstName lastName");

      res.json({
        message: "Submission graded successfully",
        submission,
      });
    } catch (error) {
      console.error("Grade submission error:", error);
      res
        .status(500)
        .json({ message: "Server error while grading submission" });
    }
  }
);

// @route   PUT /api/submissions/:id/resubmit
// @desc    Resubmit an assignment (creates version history)
// @access  Private (Student only)
router.put(
  "/:id/resubmit",
  [
    auth,
    authorize("student"),
    body("submissionText").optional().trim(),
    body("attachments").optional().isArray(),
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

      const submission = await Submission.findById(req.params.id).populate(
        "assignment"
      );

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      // Check if student owns this submission
      if (submission.student.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Check if assignment allows resubmission
      if (
        submission.assignment &&
        !submission.assignment.allowLateSubmission &&
        submission.isLate
      ) {
        return res.status(400).json({
          message: "Late submissions are not allowed for this assignment",
        });
      }

      const { submissionText, attachments } = req.body;

      // Save current version to history
      submission.history.push({
        submissionText: submission.submissionText,
        attachments: submission.attachments,
        updatedAt: new Date(),
        updatedBy: req.user._id,
      });

      // Update submission
      if (submissionText !== undefined)
        submission.submissionText = submissionText;
      if (attachments !== undefined) submission.attachments = attachments;

      submission.resubmissionCount += 1;
      submission.status = "resubmitted";
      submission.submittedAt = new Date();

      // Recalculate if late
      const isLate = submission.assignment.dueDate
        ? new Date() > new Date(submission.assignment.dueDate)
        : false;
      submission.isLate = isLate;

      await submission.save();

      res.json({
        message: "Submission resubmitted successfully",
        submission,
        resubmissionCount: submission.resubmissionCount,
      });
    } catch (error) {
      console.error("Resubmit error:", error);
      res
        .status(500)
        .json({ message: "Server error while resubmitting assignment" });
    }
  }
);

// @route   POST /api/submissions/:id/attachments
// @desc    Add attachments to a submission
// @access  Private (Student only)
router.post(
  "/:id/attachments",
  [
    auth,
    authorize("student"),
    body("attachments").isArray().withMessage("Attachments must be an array"),
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

      const submission = await Submission.findById(req.params.id);

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      // Check if student owns this submission
      if (submission.student.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { attachments } = req.body;

      // Add new attachments
      submission.attachments.push(...attachments);
      await submission.save();

      res.json({
        message: "Attachments added successfully",
        attachments: submission.attachments,
      });
    } catch (error) {
      console.error("Add attachments error:", error);
      res
        .status(500)
        .json({ message: "Server error while adding attachments" });
    }
  }
);

// @route   DELETE /api/submissions/:id/attachments/:filename
// @desc    Remove an attachment from a submission
// @access  Private (Student only)
router.delete(
  "/:id/attachments/:filename",
  [auth, authorize("student")],
  async (req, res) => {
    try {
      const submission = await Submission.findById(req.params.id);

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      // Check if student owns this submission
      if (submission.student.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { filename } = req.params;

      // Find and remove the attachment
      const attachmentIndex = submission.attachments.findIndex(
        (att) => att.filename === filename
      );

      if (attachmentIndex === -1) {
        return res.status(404).json({ message: "Attachment not found" });
      }

      submission.attachments.splice(attachmentIndex, 1);
      await submission.save();

      res.json({
        message: "Attachment removed successfully",
        attachments: submission.attachments,
      });
    } catch (error) {
      console.error("Remove attachment error:", error);
      res
        .status(500)
        .json({ message: "Server error while removing attachment" });
    }
  }
);

// @route   GET /api/submissions/:id/history
// @desc    Get submission version history
// @access  Private
router.get("/:id/history", auth, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate(
      "history.updatedBy",
      "firstName lastName"
    );

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Students can only view their own submission history
    if (
      req.user.role === "student" &&
      submission.student.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({
      history: submission.history,
      resubmissionCount: submission.resubmissionCount,
    });
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({ message: "Server error while fetching history" });
  }
});

// @route   PUT /api/submissions/:id/plagiarism
// @desc    Update plagiarism report for a submission
// @access  Private (Instructor/Admin only)
router.put(
  "/:id/plagiarism",
  [
    auth,
    authorize("instructor", "admin"),
    body("similarityScore")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Similarity score must be between 0 and 100"),
    body("flaggedSources").optional().isArray(),
    body("reportUrl").optional().isURL(),
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

      const submission = await Submission.findById(req.params.id).populate(
        "assignment"
      );

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      // Check if instructor owns this assignment
      if (
        req.user.role !== "admin" &&
        submission.assignment.instructor.toString() !== req.user._id.toString()
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { similarityScore, flaggedSources, reportUrl } = req.body;

      if (!submission.plagiarismReport) {
        submission.plagiarismReport = {};
      }

      if (similarityScore !== undefined)
        submission.plagiarismReport.similarityScore = similarityScore;
      if (flaggedSources !== undefined)
        submission.plagiarismReport.flaggedSources = flaggedSources;
      if (reportUrl !== undefined)
        submission.plagiarismReport.reportUrl = reportUrl;
      submission.plagiarismReport.scannedAt = new Date();

      await submission.save();

      res.json({
        message: "Plagiarism report updated successfully",
        plagiarismReport: submission.plagiarismReport,
      });
    } catch (error) {
      console.error("Update plagiarism report error:", error);
      res
        .status(500)
        .json({ message: "Server error while updating plagiarism report" });
    }
  }
);

// @route   POST /api/submissions/:id/achievements
// @desc    Add achievement/badge to a submission
// @access  Private (System/Admin only)
router.post(
  "/:id/achievements",
  [
    auth,
    authorize("admin"),
    body("badgeId").notEmpty().withMessage("Badge ID is required"),
    body("levelAchieved")
      .isIn(["Bronze", "Silver", "Gold", "Diamond", "Cosmic"])
      .withMessage("Invalid level"),
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

      const submission = await Submission.findById(req.params.id);

      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }

      const { badgeId, levelAchieved } = req.body;

      // Check if achievement already exists
      const existingAchievement = submission.achievements.find(
        (ach) => ach.badgeId === badgeId
      );

      if (existingAchievement) {
        return res.status(400).json({ message: "Achievement already awarded" });
      }

      submission.achievements.push({
        badgeId,
        levelAchieved,
        earnedAt: new Date(),
      });

      await submission.save();

      res.status(201).json({
        message: "Achievement awarded successfully",
        achievement:
          submission.achievements[submission.achievements.length - 1],
      });
    } catch (error) {
      console.error("Add achievement error:", error);
      res
        .status(500)
        .json({ message: "Server error while adding achievement" });
    }
  }
);

// Helper function to convert percentage to letter grade
function getLetterGrade(percentage) {
  if (percentage >= 97) return "A+";
  if (percentage >= 93) return "A";
  if (percentage >= 90) return "A-";
  if (percentage >= 87) return "B+";
  if (percentage >= 83) return "B";
  if (percentage >= 80) return "B-";
  if (percentage >= 77) return "C+";
  if (percentage >= 73) return "C";
  if (percentage >= 70) return "C-";
  if (percentage >= 67) return "D+";
  if (percentage >= 60) return "D";
  return "F";
}

module.exports = router;
