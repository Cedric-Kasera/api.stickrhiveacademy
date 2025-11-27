const mongoose = require("mongoose");

// ---------------------------------------------
// Lecture Progress Subschema
// Tracks individual lecture completion
// ---------------------------------------------
const LectureProgressSchema = new mongoose.Schema({
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  }
}, { _id: false });

// ---------------------------------------------
// Module Progress Subschema
// Tracks module completion (automatically calculated)
// ---------------------------------------------
const ModuleProgressSchema = new mongoose.Schema({
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  },
  lecturesProgress: [LectureProgressSchema]
}, { _id: false });

// ---------------------------------------------
// Course Progress Schema
// Tracks overall course progress for a student
// ---------------------------------------------
const CourseProgressSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  modulesProgress: [ModuleProgressSchema],
  completedLecturesCount: {
    type: Number,
    default: 0
  },
  totalLecturesCount: {
    type: Number,
    default: 0
  },
  progressPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for faster queries
CourseProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model("Progress", CourseProgressSchema);
