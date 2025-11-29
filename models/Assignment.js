const mongoose = require('mongoose');

/* ----------------------------------------------
   QUESTION SUB-SCHEMA
   Supports both MCQs and Written Questions
------------------------------------------------*/
const questionSchema = new mongoose.Schema({
  // The actual question text
  questionText: {
    type: String,
    required: true
  },

  // Question type: MCQ or Written
  type: {
    type: String,
    enum: ['multiple-choice', 'written'],
    required: true
  },

  /* ----------------------------------------------
     MULTIPLE CHOICE FIELDS (MCQ ONLY)
  ------------------------------------------------*/
  options: {
    type: [String],
    required: function () {
      return this.type === 'multiple-choice';
    }
  },

  // Index of correct option (0,1,2,3...)
  correctOption: {
    type: Number,
    required: function () {
      return this.type === 'multiple-choice';
    }
  },

  /* ----------------------------------------------
     WRITTEN ANSWER (CODE/DESCRIPTION)
  ------------------------------------------------*/
  expectedAnswer: {
    type: String,
    required: function () {
      return this.type === 'written';
    }
  },

  // Marks allocated
  points: {
    type: Number,
    default: 1
  },

  // Explanation shown after grading
  explanation: {
    type: String
  },

  // Difficulty is useful for analytics/badges
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'easy'
  },

  // For filtering/searching inside LMS
  tags: {
    type: [String],
    default: []
  }
});



/* ----------------------------------------------
   MAIN ASSIGNMENT SCHEMA
------------------------------------------------*/
const assignmentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Assignment title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },

  description: {
    type: String,
    required: [true, 'Assignment description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },

  instructions: {
    type: String,
    maxlength: [5000, 'Instructions cannot exceed 5000 characters']
  },

  // Reference to Course
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: [true, 'Course is required']
  },

  // Instructor who created it
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Instructor is required']
  },

  // Assignment type: quiz, homework, project, exam...
  type: {
    type: String,
    enum: ['homework', 'quiz', 'exam', 'project', 'presentation'],
    required: [true, 'Assignment type is required']
  },

  // Total marks possible
  totalPoints: {
    type: Number,
    required: [true, 'Total points are required'],
    min: [1, 'Total points must be at least 1']
  },

  // Submission deadline
  dueDate: {
    type: Date,
    required: [true, 'Due date is required'],
    validate: {
      validator: function (value) {
        return value && value > new Date();
      },
      message: 'Due date must be in the future'
    }
  },

  // Whether students can see it
  isPublished: {
    type: Boolean,
    default: false
  },

  publishDate: {
    type: Date,
    default: Date.now
  },

  // Allow late submissions?
  allowLateSubmission: {
    type: Boolean,
    default: true
  },

  // Penalty percentage for late work
  latePenalty: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },

  // Submission type (file upload, text, or both)
  submissionType: {
    type: String,
    enum: ['file', 'text', 'both'],
    default: 'text'
  },

  // Allowed file types for file submissions
  allowedFileTypes: {
    type: [String],
    default: []
  },

  // Maximum file size in bytes
  maxFileSize: {
    type: Number,
    default: 10485760 // 10MB default
  },

  /* ----------------------------------------------
     GRADING RUBRIC (Instructor-defined)
  ------------------------------------------------*/
  rubric: [{
    criterion: {
      type: String,
      required: [true, 'Criterion name is required'],
      maxlength: 100
    },
    value: {
      type: Number,
      min: [0, 'Criterion value cannot be negative'],
      required: [true, 'Criterion value is required']
    },
    description: {
      type: String,
      maxlength: 500
    }
  }],

  /* ----------------------------------------------
     QUIZ / EXAM SETTINGS
     (only used when type = "quiz" or "exam")
  ------------------------------------------------*/
  quizSettings: {
    randomizeQuestions: {
      type: Boolean,
      default: false
    },
    timeLimit: { // in minutes (null = no limit)
      type: Number,
      default: null
    },
    maxAttempts: {
      type: Number,
      default: 1
    },
    autoGrade: { // MCQs = auto graded, written = manual/AI graded
      type: Boolean,
      default: true
    }
  },

  /* ----------------------------------------------
     QUESTIONS ARRAY
     Supports MCQs + Written
  ------------------------------------------------*/
  questions: {
    type: [questionSchema],
    default: []
  }

}, {
  timestamps: true
});



/* ----------------------------------------------
   INDEXES FOR FASTER QUERYING
------------------------------------------------*/
assignmentSchema.index({ course: 1 });
assignmentSchema.index({ instructor: 1 });
assignmentSchema.index({ dueDate: 1 });
assignmentSchema.index({ isPublished: 1 });



/* ----------------------------------------------
   VIRTUALS (computed fields)
------------------------------------------------*/

// Virtual to check if assignment is overdue
assignmentSchema.virtual('isOverdue').get(function () {
  return this.dueDate ? new Date() > this.dueDate : false;
});

// Virtual to get formatted due date (YYYY-MM-DD)
assignmentSchema.virtual('formattedDueDate').get(function () {
  return this.dueDate ? this.dueDate.toISOString().split('T')[0] : '';
});

// Virtual: show time remaining until deadline
assignmentSchema.virtual('timeUntilDue').get(function () {
  if (!this.dueDate) return 'No due date';

  const now = new Date();
  const diffTime = this.dueDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `${Math.abs(diffDays)} days overdue`;
  } else if (diffDays === 0) {
    return 'Due today';
  } else {
    return `${diffDays} days remaining`;
  }
});



module.exports = mongoose.model('Assignment', assignmentSchema);
