const express = require('express');
const { param, validationResult } = require('express-validator');
const Progress = require('../models/CourseProgress');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Calculate progress statistics for a course
 * @param {Object} course - Course object with modules and lectures
 * @param {Object} progress - Progress document
 * @returns {Object} - Updated progress statistics
 */
const calculateProgressStats = (course, progress) => {
    let totalLectures = 0;
    let completedLectures = 0;

    // Count total lectures in the course
    course.modules.forEach(module => {
        totalLectures += module.lectures.length;
    });

    // Count completed lectures
    progress.modulesProgress.forEach(moduleProgress => {
        moduleProgress.lecturesProgress.forEach(lectureProgress => {
            if (lectureProgress.completed) {
                completedLectures++;
            }
        });
    });

    // Calculate percentage
    const progressPercentage = totalLectures > 0
        ? Math.round((completedLectures / totalLectures) * 100)
        : 0;

    // Check if course is completed
    const courseCompleted = totalLectures > 0 && completedLectures === totalLectures;

    return {
        completedLecturesCount: completedLectures,
        totalLecturesCount: totalLectures,
        progressPercentage,
        completed: courseCompleted,
        completedAt: courseCompleted ? new Date() : null
    };
};

/**
 * Initialize progress for a new enrollment
 * @param {Object} course - Course object
 * @param {String} userId - User ID
 * @param {String} courseId - Course ID
 * @returns {Object} - New progress document
 */
const initializeProgress = async (course, userId, courseId) => {
    const modulesProgress = course.modules.map(module => ({
        moduleId: module._id,
        completed: false,
        completedAt: null,
        lecturesProgress: module.lectures.map(lecture => ({
            lectureId: lecture._id,
            completed: false,
            completedAt: null
        }))
    }));

    let totalLectures = 0;
    course.modules.forEach(module => {
        totalLectures += module.lectures.length;
    });

    const progress = new Progress({
        userId,
        courseId,
        modulesProgress,
        completedLecturesCount: 0,
        totalLecturesCount: totalLectures,
        progressPercentage: 0,
        completed: false,
        completedAt: null
    });

    await progress.save();
    return progress;
};

// =====================================================
// ROUTES
// =====================================================

// @route   GET /api/progress/course/:courseId
// @desc    Get student's progress for a specific course
// @access  Private (Student/Instructor/Admin)
router.get('/course/:courseId', [
    auth,
    authorize('student', 'instructor', 'admin'),
    param('courseId').isMongoId().withMessage('Invalid course ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { courseId } = req.params;
        const userId = req.user._id;

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Check if user is enrolled (unless admin/instructor viewing)
        if (req.user.role === 'student') {
            const enrollment = await Enrollment.findOne({
                student: userId,
                course: courseId,
                status: 'enrolled'
            });

            if (!enrollment) {
                return res.status(403).json({ message: 'You are not enrolled in this course' });
            }
        }

        // Get or create progress
        let progress = await Progress.findOne({ userId, courseId });

        if (!progress) {
            progress = await initializeProgress(course, userId, courseId);
        }

        res.status(200).json({
            message: 'Progress retrieved successfully',
            progress
        });

    } catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({
            message: 'Error fetching progress',
            error: error.message
        });
    }
});

// @route   POST /api/progress/lecture/:courseId/:moduleId/:lectureId/toggle
// @desc    Mark/unmark a lecture as complete
// @access  Private (Student)
router.post('/lecture/:courseId/:moduleId/:lectureId/toggle', [
    auth,
    authorize('student'),
    param('courseId').isMongoId().withMessage('Invalid course ID'),
    param('moduleId').isMongoId().withMessage('Invalid module ID'),
    param('lectureId').isMongoId().withMessage('Invalid lecture ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { courseId, moduleId, lectureId } = req.params;
        const userId = req.user._id;

        // Verify enrollment
        const enrollment = await Enrollment.findOne({
            student: userId,
            course: courseId,
            status: 'enrolled'
        });

        if (!enrollment) {
            return res.status(403).json({ message: 'You are not enrolled in this course' });
        }

        // Get course to validate module and lecture (modules and lectures are subdocuments)
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Validate module exists in course subdocuments
        const moduleIndex = course.modules.findIndex(
            mod => mod._id.toString() === moduleId
        );
        if (moduleIndex === -1) {
            return res.status(404).json({ message: 'Module not found in course' });
        }

        const module = course.modules[moduleIndex];

        // Validate lecture exists in module subdocuments
        const lectureIndex = module.lectures.findIndex(
            lec => lec._id.toString() === lectureId
        );
        if (lectureIndex === -1) {
            return res.status(404).json({ message: 'Lecture not found in module' });
        }

        // Get or create progress
        let progress = await Progress.findOne({ userId, courseId });
        if (!progress) {
            progress = await initializeProgress(course, userId, courseId);
        }

        // Find the module progress index
        let moduleProgressIndex = progress.modulesProgress.findIndex(
            mp => mp.moduleId.toString() === moduleId
        );

        if (moduleProgressIndex === -1) {
            // Initialize module progress if not exists
            const newModuleProgress = {
                moduleId,
                completed: false,
                completedAt: null,
                lecturesProgress: module.lectures.map(lec => ({
                    lectureId: lec._id,
                    completed: false,
                    completedAt: null
                }))
            };
            progress.modulesProgress.push(newModuleProgress);
            moduleProgressIndex = progress.modulesProgress.length - 1;
        }

        // Get module progress reference
        const moduleProgress = progress.modulesProgress[moduleProgressIndex];

        // Find and toggle lecture progress
        let lectureProgressIndex = moduleProgress.lecturesProgress.findIndex(
            lp => lp.lectureId.toString() === lectureId
        );

        if (lectureProgressIndex === -1) {
            // Initialize lecture progress if not exists
            moduleProgress.lecturesProgress.push({
                lectureId,
                completed: false,
                completedAt: null
            });
            lectureProgressIndex = moduleProgress.lecturesProgress.length - 1;
        }

        // Toggle completion status
        const lectureProgress = moduleProgress.lecturesProgress[lectureProgressIndex];
        lectureProgress.completed = !lectureProgress.completed;
        lectureProgress.completedAt = lectureProgress.completed ? new Date() : null;

        // Mark modulesProgress as modified for Mongoose to detect changes in nested arrays
        progress.markModified('modulesProgress');

        // Check if all lectures in this module are completed
        const allLecturesCompleted = moduleProgress.lecturesProgress.every(lp => lp.completed);
        moduleProgress.completed = allLecturesCompleted;
        moduleProgress.completedAt = allLecturesCompleted ? new Date() : null;

        // Recalculate overall progress
        const stats = calculateProgressStats(course, progress);
        progress.completedLecturesCount = stats.completedLecturesCount;
        progress.totalLecturesCount = stats.totalLecturesCount;
        progress.progressPercentage = stats.progressPercentage;
        progress.completed = stats.completed;
        progress.completedAt = stats.completedAt;

        await progress.save();

        res.status(200).json({
            message: `Lecture ${lectureProgress.completed ? 'marked as complete' : 'unmarked'}`,
            progress
        });

    } catch (error) {
        console.error('Error toggling lecture completion:', error);
        res.status(500).json({
            message: 'Error updating progress',
            error: error.message
        });
    }
});

// @route   GET /api/progress/student/:studentId/courses
// @desc    Get all course progress for a student
// @access  Private (Student themselves, Instructor, Admin)
router.get('/student/:studentId/courses', [
    auth,
    param('studentId').isMongoId().withMessage('Invalid student ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { studentId } = req.params;

        // Authorization: students can only view their own progress
        if (req.user.role === 'student' && req.user._id.toString() !== studentId) {
            return res.status(403).json({
                message: 'You can only view your own progress'
            });
        }

        // Get all progress records for the student
        const progressRecords = await Progress.find({ userId: studentId })
            .populate('courseId', 'title courseCode thumbnailImage category level')
            .sort({ updatedAt: -1 });

        res.status(200).json({
            message: 'Student progress retrieved successfully',
            count: progressRecords.length,
            progress: progressRecords
        });

    } catch (error) {
        console.error('Error fetching student progress:', error);
        res.status(500).json({
            message: 'Error fetching student progress',
            error: error.message
        });
    }
});

// @route   GET /api/progress/course/:courseId/students
// @desc    Get progress of all students in a course
// @access  Private (Instructor, Admin)
router.get('/course/:courseId/students', [
    auth,
    authorize('instructor', 'admin'),
    param('courseId').isMongoId().withMessage('Invalid course ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { courseId } = req.params;

        // Verify course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // If instructor, verify they own the course
        if (req.user.role === 'instructor' && course.instructor.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                message: 'You can only view progress for your own courses'
            });
        }

        // Get all progress records for the course
        const progressRecords = await Progress.find({ courseId })
            .populate('userId', 'name email studentId')
            .sort({ progressPercentage: -1 });

        res.status(200).json({
            message: 'Course progress retrieved successfully',
            count: progressRecords.length,
            progress: progressRecords
        });

    } catch (error) {
        console.error('Error fetching course progress:', error);
        res.status(500).json({
            message: 'Error fetching course progress',
            error: error.message
        });
    }
});

// @route   POST /api/progress/initialize/:courseId
// @desc    Initialize progress for a student (called when enrolling)
// @access  Private (Student)
router.post('/initialize/:courseId', [
    auth,
    authorize('student'),
    param('courseId').isMongoId().withMessage('Invalid course ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { courseId } = req.params;
        const userId = req.user._id;

        // Verify enrollment
        const enrollment = await Enrollment.findOne({
            student: userId,
            course: courseId,
            status: 'enrolled'
        });

        if (!enrollment) {
            return res.status(403).json({ message: 'You are not enrolled in this course' });
        }

        // Check if progress already exists
        let progress = await Progress.findOne({ userId, courseId });
        if (progress) {
            return res.status(200).json({
                message: 'Progress already exists',
                progress
            });
        }

        // Get course
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ message: 'Course not found' });
        }

        // Initialize progress
        progress = await initializeProgress(course, userId, courseId);

        res.status(201).json({
            message: 'Progress initialized successfully',
            progress
        });

    } catch (error) {
        console.error('Error initializing progress:', error);
        res.status(500).json({
            message: 'Error initializing progress',
            error: error.message
        });
    }
});

// @route   DELETE /api/progress/course/:courseId
// @desc    Reset progress for a course (admin and also when students unenrolls)
// @access  Private (Admin and student themselves)
router.delete('/course/:courseId', [
    auth,
    authorize('admin', 'student'),
    param('courseId').isMongoId().withMessage('Invalid course ID')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { courseId } = req.params;
        const userId = req.user._id;

        const progress = await Progress.findOneAndDelete({ userId, courseId });

        if (!progress) {
            return res.status(404).json({ message: 'Progress not found' });
        }

        res.status(200).json({
            message: 'Progress reset successfully'
        });

    } catch (error) {
        console.error('Error resetting progress:', error);
        res.status(500).json({
            message: 'Error resetting progress',
            error: error.message
        });
    }
});

module.exports = router;
