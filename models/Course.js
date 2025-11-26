const mongoose = require('mongoose');

// ---------------------------------------------
// Lecture Subschema
// ---------------------------------------------
const lectureSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Lecture title is required'],
    trim: true
  },
  duration: {
    type: Number,
    required: [true, 'Lecture duration is required']
  },
  type: {
    type: String,
    enum: ['video', 'live'],
    default: 'video',
    required: true
  },
  videoSource: {
    type: String,
    enum: ['upload', 'youtube', 'vimeo', 'url', 'link'],
    default: 'upload'
  },
  videoUrl: {
    type: String,
    default: ''
  },
  liveType: {
    type: String,
    enum: ['zoom', 'google-meet', 'teams', 'other'],
    default: 'zoom'
  },
  liveLink: {
    type: String,
    default: ''
  },
  isFreePreview: {
    type: Boolean,
    default: false
  }
}, { _id: true, timestamps: true });


// ---------------------------------------------
// Module Subschema
// ---------------------------------------------
const moduleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Module title is required'],
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  lectures: {
    type: [lectureSchema],
    default: []
  }
}, { _id: true, timestamps: true });



// ---------------------------------------------
// Course Schema
// ---------------------------------------------
const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Course title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Course description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  courseCode: {
    type: String,
    required: [true, 'Course code is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Instructor is required']
  },
  credits: {
    type: Number,
    required: [true, 'Credits are required'],
    min: [1, 'Credits must be at least 1'],
    max: [10, 'Credits cannot exceed 10']
  },
  maxStudents: {
    type: Number,
    required: [true, 'Maximum students limit is required'],
    min: [1, 'Maximum students must be at least 1']
  },
  currentEnrollment: {
    type: Number,
    default: 0
  },
  fees: {
    type: Number,
    required: [true, 'Course fees are required'],
    min: [0, 'Fees cannot be negative']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['Computer Science', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Arts', 'Business', 'Other']
  },
  level: {
    type: String,
    required: [true, 'Level is required'],
    enum: ['Beginner', 'Intermediate', 'Advanced']
  },
  prerequisites: [String],
  materials: [{
    title: String,
    type: {
      type: String,
      enum: ['pdf', 'video', 'link', 'document', 'note']
    },
    url: String,
    filename: String,
    description: String,
    isFree: {
      type: Boolean,
      default: false
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],

  // ---------------------------------------------
  // Modules + Lectures
  // ---------------------------------------------
  modules: {
    type: [moduleSchema],
    default: []
  },

  isActive: {
    type: Boolean,
    default: true
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  thumbnailImage: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});


// Indexes for better performance
courseSchema.index({ courseCode: 1 });
courseSchema.index({ instructor: 1 });
courseSchema.index({ category: 1 });
courseSchema.index({ isActive: 1, isApproved: 1 });

// Virtual for enrollment status
courseSchema.virtual('isFullyEnrolled').get(function () {
  return this.currentEnrollment >= this.maxStudents;
});

module.exports = mongoose.model('Course', courseSchema);
