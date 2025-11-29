const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: [true, 'Assignment is required']
  },

  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student is required']
  },

  submissionText: {
    type: String,
    maxlength: [5000, 'Submission text cannot exceed 5000 characters']
  },

  // Quiz/Exam answers with metadata (only for quiz/exam assignments)
  quizAnswers: [{
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    questionText: String,
    questionType: {
      type: String,
      enum: ['multiple-choice', 'written']
    },
    options: [String], // For MCQ questions
    studentAnswer: mongoose.Schema.Types.Mixed, // Can be number (MCQ index) or string (written)
    correctAnswer: mongoose.Schema.Types.Mixed, // Correct option index or expected answer
    isCorrect: Boolean, // True if answer is correct (for auto-graded)
    points: Number, // Points for this question
    earnedPoints: Number, // Points earned by student
    explanation: String, // Explanation shown after grading
    difficulty: String, // Question difficulty level
    tags: [String] // Question tags for categorization
  }],

  attachments: [{
    originalName: String,
    filename: String,
    path: String,
    mimetype: String,
    size: Number,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],

  submittedAt: {
    type: Date,
    default: Date.now
  },

  isLate: {
    type: Boolean,
    default: false
  },

  status: {
    type: String,
    enum: ['submitted', 'graded', 'returned', 'resubmitted'],
    default: 'submitted'
  },

  // Track number of resubmissions
  resubmissionCount: {
    type: Number,
    default: 0
  },

  // Version history
  history: [{
    submissionText: String,
    attachments: [{
      originalName: String,
      filename: String,
      path: String
    }],
    updatedAt: Date,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],

  // Rubric-based grading support
  rubric: [{
    criterion: String,
    maxPoints: Number,
    earnedPoints: Number,
    comment: String
  }],

  grade: {
    points: {
      type: Number,
      min: 0
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100
    },
    letterGrade: {
      type: String,
      enum: [
        'A+', 'A', 'A-', 'B+', 'B', 'B-',
        'C+', 'C', 'C-', 'D+', 'D',
        'F', 'I' // I = Incomplete
      ]
    },
    gradedAt: Date,
    gradedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  feedback: {
    type: String,
    maxlength: [2000, 'Feedback cannot exceed 2000 characters']
  },

  // AI/Plagiarism report metadata
  plagiarismReport: {
    similarityScore: {
      type: Number,
      min: 0,
      max: 100
    },
    flaggedSources: [String],
    reportUrl: String,
    scannedAt: Date
  },

  // Achievement progress tracking
  achievements: [{
    badgeId: String, // e.g. "assignment-master", "first-submission"
    levelAchieved: {
      type: String,
      enum: ['Bronze', 'Silver', 'Gold', 'Diamond', 'Cosmic']
    },
    earnedAt: Date
  }]

}, {
  timestamps: true
});


/* ------------------------------
   INDEXES
------------------------------ */
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
submissionSchema.index({ student: 1 });
submissionSchema.index({ assignment: 1 });
submissionSchema.index({ status: 1 });


/* ------------------------------
   PRE-SAVE: Auto Letter Grade
------------------------------ */
submissionSchema.pre('save', function (next) {
  if (this.grade && this.grade.percentage !== undefined) {
    const p = this.grade.percentage;

    if (p >= 97) this.grade.letterGrade = 'A+';
    else if (p >= 93) this.grade.letterGrade = 'A';
    else if (p >= 90) this.grade.letterGrade = 'A-';
    else if (p >= 87) this.grade.letterGrade = 'B+';
    else if (p >= 83) this.grade.letterGrade = 'B';
    else if (p >= 80) this.grade.letterGrade = 'B-';
    else if (p >= 77) this.grade.letterGrade = 'C+';
    else if (p >= 73) this.grade.letterGrade = 'C';
    else if (p >= 70) this.grade.letterGrade = 'C-';
    else if (p >= 67) this.grade.letterGrade = 'D+';
    else if (p >= 60) this.grade.letterGrade = 'D';
    else this.grade.letterGrade = 'F';
  }

  next();
});


/* --------------------------------------
   PRE-SAVE: Detect Late Submissions
   (requires assignment.dueDate)
--------------------------------------- */
submissionSchema.pre('save', async function (next) {
  if (this.isModified('submittedAt') || this.isNew) {
    try {
      const Assignment = mongoose.model('Assignment');
      const assignment = await Assignment.findById(this.assignment).select('dueDate');

      if (assignment && assignment.dueDate) {
        this.isLate = this.submittedAt > assignment.dueDate;
      }
    } catch (err) {
      console.error('Late submission check failed:', err);
    }
  }
  next();
});


/* --------------------------------------
   PRE-SAVE: Track version history
--------------------------------------- */
submissionSchema.pre('save', function (next) {
  if (!this.isNew && this.isModified('submissionText')) {
    this.history.push({
      submissionText: this.submissionText,
      updatedAt: new Date()
    });
  }
  next();
});


module.exports = mongoose.model('Submission', submissionSchema);
