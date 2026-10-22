# Query coverage

Generated from `queries.txt` (643 read queries of the LMS app).

- **583** answered by a bot intent
- **59** deliberately not exposed in chat (reason given)
- **1** replaced (the LMS's AI SQL path; this bot never runs LLM SQL)
- **0** unmapped

## Intents

Each intent is an entity × operation (count, list, details, count_by, sum, avg, top, current) with filters
(batch, center, course, gender, status, district, date, CNIC / roll no / phone / name).

### student

Tables: `students`, `user` · Filters: batch, center, course, gender, district, qualification, status, date · Breakdowns: batch, center, course, gender, district, qualification, status

- How many students enrolled in batch 10 → `count`
- how mny studnts in btch 10 → `count`
- total students → `count`
- number of students in ITTI → `count`
- kitne students hain ITTI mein → `count`
- kitne bachay hain batch 9 mein → `count`
- female students in batch 9 → `count`
- how many girls in turbat → `count`
- boys in gwadar center → `count`
- how many in batch 10 → `count`
- students in current batch → `count`
- students in running batch → `count`

### candidate

Tables: `candidates` · Filters: batch, center, course, gender, status, city, district, date · Breakdowns: batch, center, course, gender, status, city

- how many applicants admitted this month → `count`
- total applications → `count`
- applicants by center → `count_by`
- female applicants for batch 10 → `count`
- candidates applied today → `count`
- average test marks of candidates → `avg`
- admissions by gender → `count_by`

### trainer

Tables: `trainers`, `user`, `trainers_center_allocation` · Filters: course, center, batch, status · Breakdowns: course, status

- how many trainers → `count`
- trainers in turbat center → `count`
- list trainers of web development → `list`
- teachers in batch 10 → `count`

### allocation

Tables: `trainers_center_allocation`, `trainers`, `user` · Filters: batch, center, course · Breakdowns: batch, center, course

- trainer allocations in ITTI batch 10 → `count`

### batch

Tables: `training_batches` · Filters: status · Breakdowns: status

- which batch is currently running → `current`
- current batch → `current`
- konsa batch chal raha hai → `current`
- list batches → `list`
- how many batches → `count`
- batch 9 details → `details`

### center

Tables: `centers` · Filters: status, type, city · Breakdowns: status, type, city

- how many centers we have → `count`
- list all centers → `list`
- ITTI → `details`
- quetaa center details → `details`
- centers by type → `count_by`

### course

Tables: `courses` · Filters: status · Breakdowns: status

- courses list → `list`
- how many courses → `count`
- kitne courses hain → `count`

### attendance

Tables: `attendance` · Filters: batch, center, course, status, date · Breakdowns: status, batch, center, course

- attendance of 54401-6647329-0 → `count_by`
- attendance today → `count`
- absent students today in ITTI → `count`
- kitne students present hain aaj → `count`
- attendance breakdown this week → `count_by`
- attendence by center today → `count_by`

### earning

Tables: `earnings` · Filters: batch, center, course, status, platform, date · Breakdowns: batch, center, course, platform, status

- earnings of student 5440166473290 → `list`
- total earnings batch 10 → `sum`
- kitni kamai hui is mahine → `sum`
- top 5 earners → `top`
- earnings by platform → `count_by`
- fiverr earnings → `sum`

### ticket

Tables: `tickets` · Filters: batch, center, course, status, date · Breakdowns: status, batch, center, course

- tickets of DB10-0240252-0 → `list`
- open tickets → `count`
- tickets by center → `count_by`

### assignment

Tables: `assignments` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- how many assignments in batch 10 → `count`

### submission

Tables: `assignment_submissions`, `assignments` · Filters: batch, center, course, status, date · Breakdowns: batch, center, course, status

- assignment submissions this week → `count`

### result

Tables: `exam_assessment` · Filters: batch, center, course, type · Breakdowns: batch, center, course, type

- result of 54401-6647329-0 → `list`
- average exam score batch 9 → `avg`
- top 10 students by score → `top`

### leave

Tables: `students_leaves` · Filters: batch, center, course, status, date · Breakdowns: status, batch, center, course

- leaves of 54401-6647329-0 → `list`
- student leaves this month → `count`

### trainer_leave

Tables: `trainer_leaves`, `user` · Filters: batch, center, course, status, date · Breakdowns: status, center, course

- trainer leaves → `count`

### holiday

Tables: `holidays` · Filters: batch, center, date · Breakdowns: batch, center

- holidays this month → `list`

### schedule

Tables: `class_schedules` · Filters: batch, center, course · Breakdowns: batch, center, course

- class timings for web development at ITTI → `list`

### center_dates

Tables: `centers_dates` · Filters: batch, center · Breakdowns: batch, center


### recording

Tables: `lecture_recordings` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- lecture recordings of graphic design → `list`

### resource

Tables: `learning_resources` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- learning resources for digital marketing → `list`

### lecture_report

Tables: `daily_lecture_reports` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- daily lecture reports today → `count`

### trainer_attendance

Tables: `trainer_attendance`, `user` · Filters: batch, center, date · Breakdowns: batch, center

- trainer attendance today → `count`

### quiz_attempt

Tables: `student_quiz_attempts` · Filters: batch, center, course, status, date · Breakdowns: batch, center, course, status

- quiz attempts batch 10 → `count`

### feedback

Tables: `students_feedback` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- feedback count this month → `count`

### document

Tables: `students_docs` · Filters: batch, status, type · Breakdowns: type, status, batch


### freelance_profile

Tables: `students_freelancing_profiles` · Filters: status, platform · Breakdowns: platform, status


### announcement

Tables: `class_announcements` · Filters: batch, center, course, date · Breakdowns: batch, center, course

- announcements in ITTI → `list`

### master_trainer

Tables: `mastertrainers`, `user` · Filters: course · Breakdowns: course

- master trainers → `count`

### module

Tables: `modules` · Filters: course · Breakdowns: course

- modules of web development → `list`

### topic

Tables: `topics`, `modules` · Filters: course · Breakdowns: course


### topic_report

Tables: `trainer_topic_reports`, `topics` · Filters: batch, center, course, status, date · Breakdowns: center, course, batch, status


### login

Tables: `login_logs` · Filters: batch, center, course, type, date · Breakdowns: type, center, batch

- logins today → `count`

### center_visit

Tables: `center_visits` · Filters: center, batch, status, date · Breakdowns: center, status

- center visits this month → `count`

### weekly_evaluation

Tables: `weekly_evaluations`, `user` · Filters: batch, status, date · Breakdowns: status, batch

- weekly evaluations → `count`

### online_class_report

Tables: `online_class_reports` · Filters: center, batch, status, date · Breakdowns: center, status


### quiz

Tables: `student_quiz` · Filters: batch, date · Breakdowns: batch


### user

Tables: `user` · Filters: type, status · Breakdowns: type, status

- user accounts by type → `count_by`

## Inventory entries

| # | Source | Tables | Covered by |
|---|---|---|---|
| A01 | `controllers/centerVisitController.js:702` | trainers_center_allocation | trainer, allocation |
| A02 | `controllers/profileController.js:23` | assignments | assignment, submission |
| A03 | `controllers/profileController.js:49` | assignment_submissions, assignments | submission, assignment |
| A04 | `controllers/profileController.js:100` | tickets | ticket |
| A05 | `controllers/profileController.js:113` | students_feedback | feedback |
| A06 | `controllers/profileController.js:126` | students_docs | document |
| A07 | `controllers/profileController.js:139` | students_freelancing_profiles | freelance_profile |
| A08 | `controllers/profileController.js:344` | user, students, courses, centers | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user, course, center |
| A09 | `controllers/studentController.js:253` | tickets | ticket |
| A10 | `controllers/studentController.js:262` | students_feedback | feedback |
| A11 | `controllers/studentController.js:271` | students_docs | document |
| A12 | `controllers/studentController.js:279` | students_freelancing_profiles | freelance_profile |
| A13 | `controllers/studentController.js:447` | assignments | assignment, submission |
| A14 | `controllers/studentController.js:470` | assignment_submissions, assignments | submission, assignment |
| A15 | `controllers/studentController.js:823` | user, students, courses, centers | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user, course, center |
| A16 | `controllers/studentPurgeController.js:138` | <dynamic> | excluded: table chosen at runtime by an internal purge/maintenance routine |
| A17 | `controllers/studentPurgeController.js:164` | <dynamic> | excluded: table chosen at runtime by an internal purge/maintenance routine |
| A18 | `utils/dbSchema.js:95` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A19 | `utils/dbSchema.js:101` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A20 | `utils/dbSchema.js:111` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A21 | `utils/ensureSchema.js:462` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A22 | `utils/ensureSchema.js:499` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A23 | `utils/ensureSchema.js:511` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A24 | `utils/ensureSchema.js:607` | information_schema | excluded: schema introspection; the bot reads the schema itself at startup |
| A25 | `utils/evaluationMetrics.js:193` | activity_log, students | student |
| B1 | `utils/aiReadOnlyDb.js:140` | <llm-sql> | replaced: the LMS's AI SQL path; this bot uses fixed handlers instead (never runs LLM SQL) |
| C001 | `controllers/activityLogController.js:32` | centers | center |
| C002 | `controllers/activityLogController.js:33` | courses | course |
| C003 | `controllers/activityLogController.js:34` | training_batches | batch |
| C004 | `controllers/activityLogController.js:83` | activity_log | excluded: audit trail of edits |
| C005 | `controllers/activityLogController.js:96` | students | student |
| C006 | `controllers/activityLogController.js:101` | assignments | assignment, submission |
| C007 | `controllers/activityLogController.js:106` | assignment_submissions | submission |
| C008 | `controllers/activityLogController.js:111` | tickets | ticket |
| C009 | `controllers/activityLogController.js:116` | earnings | earning |
| C010 | `controllers/activityLogController.js:169` | activity_log | excluded: audit trail of edits |
| C011 | `controllers/adminController.js:102` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C012 | `controllers/adminController.js:207` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C013 | `controllers/adminController.js:241` | training_batches | batch |
| C014 | `controllers/adminController.js:257` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C015 | `controllers/adminController.js:303` | trainers | trainer, allocation |
| C016 | `controllers/adminController.js:314` | trainers_center_allocation | trainer, allocation |
| C017 | `controllers/adminController.js:323` | trainers_center_allocation | trainer, allocation |
| C018 | `controllers/adminController.js:346` | students | student |
| C019 | `controllers/adminController.js:382` | centerusers | excluded: staff accounts / authentication |
| C020 | `controllers/adminController.js:398` | mastertrainers | master_trainer |
| C021 | `controllers/adminController.js:464` | training_batches | batch |
| C022 | `controllers/adminController.js:479` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C023 | `controllers/adminController.js:502` | trainers | trainer, allocation |
| C024 | `controllers/adminController.js:513` | trainers_center_allocation | trainer, allocation |
| C025 | `controllers/adminController.js:522` | trainers_center_allocation | trainer, allocation |
| C026 | `controllers/adminController.js:544` | students | student |
| C027 | `controllers/adminController.js:568` | centerusers | excluded: staff accounts / authentication |
| C028 | `controllers/adminController.js:584` | mastertrainers | master_trainer |
| C029 | `controllers/adminController.js:711` | admins | excluded: staff accounts / authentication |
| C030 | `controllers/adminController.js:754` | admins | excluded: staff accounts / authentication |
| C031 | `controllers/adminController.js:792` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C032 | `controllers/adminController.js:802` | students | student |
| C033 | `controllers/adminController.js:918` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C034 | `controllers/adminController.js:932` | students | student |
| C035 | `controllers/adminController.js:1017` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C036 | `controllers/adminController.js:1060` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C037 | `controllers/adminController.js:1156` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C038 | `controllers/adminController.js:1166` | students | student |
| C039 | `controllers/admissionControlController.js:26` | admission_controls | excluded: portal configuration |
| C040 | `controllers/admissionControlController.js:49` | admission_controls | excluded: portal configuration |
| C041 | `controllers/admissionControlController.js:134` | admission_controls | excluded: portal configuration |
| C042 | `controllers/assignmentController.js:82` | training_batches | batch |
| C043 | `controllers/assignmentController.js:98` | trainers | trainer, allocation |
| C044 | `controllers/assignmentController.js:110` | trainers_center_allocation | trainer, allocation |
| C045 | `controllers/assignmentController.js:215` | assignments | assignment, submission |
| C046 | `controllers/assignmentController.js:287` | assignments | assignment, submission |
| C047 | `controllers/assignmentController.js:316` | assignment_submissions | submission |
| C048 | `controllers/assignmentController.js:332` | students | student |
| C049 | `controllers/assignmentController.js:419` | assignments | assignment, submission |
| C050 | `controllers/assignmentController.js:476` | assignments | assignment, submission |
| C051 | `controllers/assignmentController.js:515` | assignments | assignment, submission |
| C052 | `controllers/assignmentController.js:533` | assignments | assignment, submission |
| C053 | `controllers/assignmentController.js:538` | assignment_submissions | submission |
| C054 | `controllers/assignmentSubmissionController.js:86` | assignments | assignment, submission |
| C055 | `controllers/assignmentSubmissionController.js:104` | assignment_submissions | submission |
| C056 | `controllers/assignmentSubmissionController.js:223` | assignments | assignment, submission |
| C057 | `controllers/assignmentSubmissionController.js:241` | assignment_submissions | submission |
| C058 | `controllers/assignmentSubmissionController.js:300` | assignments | assignment, submission |
| C059 | `controllers/assignmentSubmissionController.js:318` | students | student |
| C060 | `controllers/assignmentSubmissionController.js:332` | assignment_submissions | submission |
| C061 | `controllers/assignmentSubmissionController.js:435` | assignment_submissions | submission |
| C062 | `controllers/assignmentSubmissionController.js:442` | assignments | assignment, submission |
| C063 | `controllers/attendanceController.js:70` | trainers | trainer, allocation |
| C064 | `controllers/attendanceController.js:79` | trainers_center_allocation | trainer, allocation |
| C065 | `controllers/attendanceController.js:104` | students | student |
| C066 | `controllers/attendanceController.js:252` | trainers | trainer, allocation |
| C067 | `controllers/attendanceController.js:257` | trainers_center_allocation | trainer, allocation |
| C068 | `controllers/attendanceController.js:342` | trainers | trainer, allocation |
| C069 | `controllers/attendanceController.js:349` | trainers_center_allocation | trainer, allocation |
| C070 | `controllers/attendanceController.js:397` | centers_dates | center_dates |
| C071 | `controllers/attendanceController.js:418` | students | student |
| C072 | `controllers/attendanceController.js:423` | attendance | attendance |
| C073 | `controllers/attendanceController.js:544` | trainers | trainer, allocation |
| C074 | `controllers/attendanceController.js:549` | trainers_center_allocation | trainer, allocation |
| C075 | `controllers/attendanceController.js:579` | attendance | attendance |
| C076 | `controllers/attendanceController.js:635` | attendance | attendance |
| C077 | `controllers/attendanceController.js:683` | students | student |
| C078 | `controllers/attendanceController.js:750` | students | student |
| C079 | `controllers/attendanceController.js:764` | students | student |
| C080 | `controllers/attendanceController.js:775` | trainers | trainer, allocation |
| C081 | `controllers/attendanceController.js:779` | trainers_center_allocation | trainer, allocation |
| C082 | `controllers/attendanceController.js:808` | centers | center |
| C083 | `controllers/attendanceController.js:809` | courses | course |
| C084 | `controllers/candidateController.js:67` | courses | course |
| C085 | `controllers/candidateController.js:72` | centers | center |
| C086 | `controllers/candidateController.js:75` | training_batches | batch |
| C087 | `controllers/candidateController.js:133` | candidates | candidate |
| C088 | `controllers/candidateController.js:220` | admission_controls | excluded: portal configuration |
| C089 | `controllers/candidateController.js:233` | students | student |
| C090 | `controllers/candidateController.js:253` | candidates | candidate |
| C091 | `controllers/candidateController.js:299` | candidates | candidate |
| C092 | `controllers/candidateController.js:346` | candidates | candidate |
| C093 | `controllers/candidateController.js:350` | candidates | candidate |
| C094 | `controllers/candidateController.js:380` | candidates | candidate |
| C095 | `controllers/candidateController.js:381` | candidates | candidate |
| C096 | `controllers/candidateController.js:384` | candidates | candidate |
| C097 | `controllers/candidateController.js:391` | candidates | candidate |
| C098 | `controllers/candidateController.js:404` | candidates | candidate |
| C099 | `controllers/candidateController.js:407` | candidates | candidate |
| C100 | `controllers/candidateController.js:417` | candidates | candidate |
| C101 | `controllers/candidateController.js:423` | candidates | candidate |
| C102 | `controllers/candidateController.js:429` | candidates | candidate |
| C103 | `controllers/candidateController.js:435` | candidates | candidate |
| C104 | `controllers/candidateController.js:441` | candidates | candidate |
| C105 | `controllers/candidateController.js:447` | candidates | candidate |
| C106 | `controllers/candidateController.js:456` | candidates | candidate |
| C107 | `controllers/candidateController.js:479` | candidates | candidate |
| C108 | `controllers/candidateController.js:501` | candidates | candidate |
| C109 | `controllers/candidateController.js:519` | candidates | candidate |
| C110 | `controllers/candidateController.js:661` | candidates | candidate |
| C111 | `controllers/candidateController.js:665` | candidates | candidate |
| C112 | `controllers/candidateController.js:689` | candidates | candidate |
| C113 | `controllers/candidateController.js:690` | candidates | candidate |
| C114 | `controllers/candidateController.js:693` | candidates | candidate |
| C115 | `controllers/candidateController.js:700` | candidates | candidate |
| C116 | `controllers/candidateController.js:713` | candidates | candidate |
| C117 | `controllers/candidateController.js:716` | candidates | candidate |
| C118 | `controllers/candidateController.js:729` | candidates | candidate |
| C119 | `controllers/candidateController.js:749` | candidates | candidate |
| C120 | `controllers/candidateController.js:768` | candidates | candidate |
| C121 | `controllers/candidateController.js:784` | candidates | candidate |
| C122 | `controllers/candidateController.js:925` | candidates | candidate |
| C123 | `controllers/candidateController.js:1086` | candidates | candidate |
| C124 | `controllers/candidateController.js:1093` | students | student |
| C125 | `controllers/candidateController.js:1130` | centers | center |
| C126 | `controllers/candidateController.js:1131` | courses | course |
| C127 | `controllers/candidateEnrollmentController.js:70` | students | student |
| C128 | `controllers/candidateEnrollmentController.js:95` | candidates | candidate |
| C129 | `controllers/candidateEnrollmentController.js:107` | students | student |
| C130 | `controllers/candidateEnrollmentController.js:188` | students | student |
| C131 | `controllers/candidateEnrollmentController.js:210` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C132 | `controllers/candidateEnrollmentController.js:339` | centers | center |
| C133 | `controllers/candidateEnrollmentController.js:340` | courses | course |
| C134 | `controllers/candidateEnrollmentController.js:403` | candidates | candidate |
| C135 | `controllers/candidateEnrollmentController.js:531` | candidates | candidate |
| C136 | `controllers/candidateEnrollmentController.js:540` | candidates | candidate |
| C137 | `controllers/candidateEnrollmentController.js:749` | candidates | candidate |
| C138 | `controllers/centersController.js:42` | centers | center |
| C139 | `controllers/centersController.js:54` | centers | center |
| C140 | `controllers/centersController.js:94` | centers | center |
| C141 | `controllers/centersDatesController.js:15` | centers_dates | center_dates |
| C142 | `controllers/centersDatesController.js:48` | centers_dates | center_dates |
| C143 | `controllers/centersDatesController.js:78` | centers_dates | center_dates |
| C144 | `controllers/centerUsersController.js:29` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C145 | `controllers/centerUsersController.js:126` | centerusers | excluded: staff accounts / authentication |
| C146 | `controllers/centerUsersController.js:308` | centerusers | excluded: staff accounts / authentication |
| C147 | `controllers/centerVisitController.js:54` | mastertrainers | master_trainer |
| C148 | `controllers/centerVisitController.js:87` | mastertrainers | master_trainer |
| C149 | `controllers/centerVisitController.js:127` | center_visits | center_visit |
| C150 | `controllers/centerVisitController.js:211` | center_visits | center_visit |
| C151 | `controllers/centerVisitController.js:301` | center_visits | center_visit |
| C152 | `controllers/centerVisitController.js:449` | center_visits | center_visit |
| C153 | `controllers/centerVisitController.js:484` | center_visits | center_visit |
| C154 | `controllers/centerVisitController.js:530` | center_visits | center_visit |
| C155 | `controllers/centerVisitController.js:549` | mastertrainers | master_trainer |
| C156 | `controllers/centerVisitController.js:624` | center_visits | center_visit |
| C157 | `controllers/centerVisitController.js:638` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C158 | `controllers/centerVisitController.js:714` | center_visits | center_visit |
| C159 | `controllers/classAnnouncementsController.js:22` | trainers | trainer, allocation |
| C160 | `controllers/classAnnouncementsController.js:38` | trainers_center_allocation | trainer, allocation |
| C161 | `controllers/classAnnouncementsController.js:110` | trainers | trainer, allocation |
| C162 | `controllers/classAnnouncementsController.js:121` | trainers_center_allocation | trainer, allocation |
| C163 | `controllers/classAnnouncementsController.js:140` | mastertrainers | master_trainer |
| C164 | `controllers/classAnnouncementsController.js:149` | students | student |
| C165 | `controllers/classAnnouncementsController.js:158` | class_announcements | announcement |
| C166 | `controllers/classAnnouncementsController.js:210` | class_announcements | announcement |
| C167 | `controllers/classAnnouncementsController.js:243` | class_announcements | announcement |
| C168 | `controllers/classAnnouncementsController.js:282` | students | student |
| C169 | `controllers/classScheduleController.js:88` | candidates | candidate |
| C170 | `controllers/classScheduleController.js:97` | students | student |
| C171 | `controllers/classScheduleController.js:103` | class_schedules | schedule |
| C172 | `controllers/classScheduleController.js:104` | centers | center |
| C173 | `controllers/classScheduleController.js:105` | courses | course |
| C174 | `controllers/classScheduleController.js:211` | class_schedules | schedule |
| C175 | `controllers/classScheduleController.js:252` | class_schedules | schedule |
| C176 | `controllers/classScheduleController.js:274` | class_schedules | schedule |
| C177 | `controllers/courseController.js:15` | courses | course |
| C178 | `controllers/courseController.js:50` | courses | course |
| C179 | `controllers/courseController.js:64` | courses | course |
| C180 | `controllers/courseController.js:86` | courses | course |
| C181 | `controllers/courseModuleController.js:10` | trainers_center_allocation | trainer, allocation |
| C182 | `controllers/courseModuleController.js:27` | modules | module, topic |
| C183 | `controllers/courseModuleController.js:45` | modules | module, topic |
| C184 | `controllers/courseModuleController.js:109` | modules | module, topic |
| C185 | `controllers/courseModuleController.js:140` | modules | module, topic |
| C186 | `controllers/courseModuleController.js:161` | modules | module, topic |
| C187 | `controllers/courseModuleController.js:165` | topics | topic, topic_report |
| C188 | `controllers/dailyLectureReportController.js:41` | trainers | trainer, allocation |
| C189 | `controllers/dailyLectureReportController.js:52` | trainers_center_allocation | trainer, allocation |
| C190 | `controllers/dailyLectureReportController.js:69` | daily_lecture_reports | lecture_report |
| C191 | `controllers/dailyLectureReportController.js:145` | trainers | trainer, allocation |
| C192 | `controllers/dailyLectureReportController.js:153` | mastertrainers | master_trainer |
| C193 | `controllers/dailyLectureReportController.js:163` | centers_dates | center_dates |
| C194 | `controllers/dailyLectureReportController.js:199` | holidays | holiday |
| C195 | `controllers/dailyLectureReportController.js:214` | daily_lecture_reports | lecture_report |
| C196 | `controllers/dailyLectureReportController.js:287` | daily_lecture_reports | lecture_report |
| C197 | `controllers/dailyLectureReportController.js:301` | daily_lecture_reports | lecture_report |
| C198 | `controllers/dailyLectureReportController.js:314` | daily_lecture_reports | lecture_report |
| C199 | `controllers/dashboarController.js:44` | students | student |
| C200 | `controllers/dashboarController.js:60` | students_docs | document |
| C201 | `controllers/dashboarController.js:107` | exam_assessment | result |
| C202 | `controllers/dashboarController.js:125` | assignments | assignment, submission |
| C203 | `controllers/dashboarController.js:139` | courses | course |
| C204 | `controllers/dashboarController.js:144` | centers | center |
| C205 | `controllers/dashboarController.js:153` | assignment_submissions | submission |
| C206 | `controllers/dashboarController.js:177` | assignment_submissions | submission |
| C207 | `controllers/dashboarController.js:209` | assignments | assignment, submission |
| C208 | `controllers/dashboarController.js:217` | assignment_submissions | submission |
| C209 | `controllers/dashboarController.js:233` | trainers_center_allocation | trainer, allocation |
| C210 | `controllers/dashboarController.js:244` | student_quiz | quiz |
| C211 | `controllers/dashboarController.js:252` | student_quiz_attempts | quiz_attempt |
| C212 | `controllers/dashboarController.js:264` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C213 | `controllers/dashboarController.js:296` | student_quiz_attempts | quiz_attempt |
| C214 | `controllers/dashboarController.js:318` | assignment_submissions | submission |
| C215 | `controllers/dashboarController.js:336` | student_quiz | quiz |
| C216 | `controllers/dashboarController.js:342` | student_quiz_attempts | quiz_attempt |
| C217 | `controllers/dashboarController.js:355` | earnings | earning |
| C218 | `controllers/dashboarController.js:364` | class_announcements | announcement |
| C219 | `controllers/dashboarController.js:376` | class_announcements | announcement |
| C220 | `controllers/dashboarController.js:386` | student_quiz | quiz |
| C221 | `controllers/dashboarController.js:396` | assignments | assignment, submission |
| C222 | `controllers/dashboarController.js:401` | earnings | earning |
| C223 | `controllers/dashboarController.js:409` | tickets | ticket |
| C224 | `controllers/dashboarController.js:417` | lecture_recordings | recording |
| C225 | `controllers/dashboarController.js:422` | learning_resources | resource |
| C226 | `controllers/dashboarController.js:429` | students_feedback | feedback |
| C227 | `controllers/dashboarController.js:437` | training_batches | batch |
| C228 | `controllers/dashboarController.js:440` | centers | center |
| C229 | `controllers/dashboarController.js:443` | courses | course |
| C230 | `controllers/dashboarController.js:517` | trainers | trainer, allocation |
| C231 | `controllers/dashboarController.js:526` | trainers_center_allocation | trainer, allocation |
| C232 | `controllers/dashboarController.js:574` | students_leaves | leave |
| C233 | `controllers/dashboarController.js:583` | centers_dates | center_dates |
| C234 | `controllers/dashboarController.js:633` | holidays | holiday |
| C235 | `controllers/dashboarController.js:652` | attendance | attendance |
| C236 | `controllers/dashboarController.js:689` | attendance | attendance |
| C237 | `controllers/dashboarController.js:699` | daily_lecture_reports | lecture_report |
| C238 | `controllers/dashboarController.js:715` | assignments | assignment, submission |
| C239 | `controllers/dashboarController.js:724` | students | student |
| C240 | `controllers/dashboarController.js:732` | students | student |
| C241 | `controllers/dashboarController.js:739` | earnings | earning |
| C242 | `controllers/dashboarController.js:750` | earnings | earning |
| C243 | `controllers/dashboarController.js:759` | tickets | ticket |
| C244 | `controllers/dashboarController.js:802` | mastertrainers | master_trainer |
| C245 | `controllers/dashboarController.js:825` | trainers_center_allocation | trainer, allocation |
| C246 | `controllers/dashboarController.js:869` | students | student |
| C247 | `controllers/dashboarController.js:877` | tickets | ticket |
| C248 | `controllers/dashboarController.js:885` | assignments | assignment, submission |
| C249 | `controllers/dashboarController.js:896` | student_quiz | quiz |
| C250 | `controllers/dashboarController.js:903` | earnings | earning |
| C251 | `controllers/dashboarController.js:914` | earnings | earning |
| C252 | `controllers/dashboarController.js:925` | centers_dates | center_dates |
| C253 | `controllers/dashboarController.js:960` | holidays | holiday |
| C254 | `controllers/dashboarController.js:972` | daily_lecture_reports | lecture_report |
| C255 | `controllers/dashboarController.js:1036` | centerusers | excluded: staff accounts / authentication |
| C256 | `controllers/dashboarController.js:1048` | students | student |
| C257 | `controllers/dashboarController.js:1064` | earnings | earning |
| C258 | `controllers/earningsController.js:19` | mastertrainers | master_trainer |
| C259 | `controllers/earningsController.js:71` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C260 | `controllers/earningsController.js:83` | students | student |
| C261 | `controllers/earningsController.js:96` | trainers_center_allocation | trainer, allocation |
| C262 | `controllers/earningsController.js:186` | earnings | earning |
| C263 | `controllers/earningsController.js:228` | students | student |
| C264 | `controllers/earningsController.js:236` | earnings | earning |
| C265 | `controllers/earningsController.js:260` | earnings | earning |
| C266 | `controllers/earningsController.js:328` | earnings | earning |
| C267 | `controllers/earningsController.js:392` | earnings | earning |
| C268 | `controllers/earningsController.js:447` | earnings | earning |
| C269 | `controllers/earningsController.js:526` | trainers_center_allocation | trainer, allocation |
| C270 | `controllers/earningsController.js:989` | trainers | trainer, allocation |
| C271 | `controllers/earningsController.js:994` | trainers_center_allocation | trainer, allocation |
| C272 | `controllers/emailCampaignController.js:74` | email_campaign_recipients | excluded: email delivery internals |
| C273 | `controllers/emailCampaignController.js:308` | email_campaigns | excluded: email delivery internals |
| C274 | `controllers/emailCampaignController.js:339` | email_campaigns | excluded: email delivery internals |
| C275 | `controllers/emailCampaignController.js:371` | email_campaign_recipients | excluded: email delivery internals |
| C276 | `controllers/emailCampaignController.js:419` | email_campaigns | excluded: email delivery internals |
| C277 | `controllers/emailCampaignController.js:426` | email_campaign_recipients | excluded: email delivery internals |
| C278 | `controllers/emailCampaignController.js:475` | email_campaigns | excluded: email delivery internals |
| C279 | `controllers/emailCampaignController.js:503` | email_campaigns | excluded: email delivery internals |
| C280 | `controllers/emailCampaignController.js:574` | email_campaigns | excluded: email delivery internals |
| C281 | `controllers/emailCampaignController.js:599` | email_campaign_recipients | excluded: email delivery internals |
| C282 | `controllers/emailCampaignController.js:641` | email_campaigns | excluded: email delivery internals |
| C283 | `controllers/emailVerificationController.js:143` | email_verifications | excluded: sign-up verification codes (sensitive) |
| C284 | `controllers/emailVerificationController.js:310` | email_verifications | excluded: sign-up verification codes (sensitive) |
| C285 | `controllers/emailVerificationController.js:374` | email_verifications | excluded: sign-up verification codes (sensitive) |
| C286 | `controllers/emailVerificationController.js:393` | email_verifications | excluded: sign-up verification codes (sensitive) |
| C287 | `controllers/examAssessmentController.js:16` | training_batches | batch |
| C288 | `controllers/examAssessmentController.js:17` | centers | center |
| C289 | `controllers/examAssessmentController.js:18` | courses | course |
| C290 | `controllers/examAssessmentController.js:28` | students | student |
| C291 | `controllers/examAssessmentController.js:40` | exam_assessment | result |
| C292 | `controllers/examAssessmentController.js:107` | exam_assessment | result |
| C293 | `controllers/examAssessmentController.js:142` | mastertrainers | master_trainer |
| C294 | `controllers/examAssessmentController.js:154` | exam_assessment | result |
| C295 | `controllers/examAssessmentController.js:165` | students | student |
| C296 | `controllers/examAssessmentController.js:170` | earnings | earning |
| C297 | `controllers/examAssessmentController.js:207` | exam_assessment | result |
| C298 | `controllers/examAssessmentController.js:221` | students | student |
| C299 | `controllers/examAssessmentController.js:226` | earnings | earning |
| C300 | `controllers/examAssessmentController.js:270` | mastertrainers | master_trainer |
| C301 | `controllers/examAssessmentController.js:281` | exam_assessment | result |
| C302 | `controllers/examAssessmentController.js:309` | exam_assessment | result |
| C303 | `controllers/examAssessmentController.js:350` | exam_assessment | result |
| C304 | `controllers/examAssessmentController.js:399` | exam_assessment | result |
| C305 | `controllers/feedbackController.js:17` | students_feedback | feedback |
| C306 | `controllers/feedbackController.js:48` | students | student |
| C307 | `controllers/feedbackController.js:67` | students_feedback | feedback |
| C308 | `controllers/feedbackController.js:147` | trainers_center_allocation | trainer, allocation |
| C309 | `controllers/feedbackController.js:165` | students_feedback | feedback |
| C310 | `controllers/feedbackController.js:269` | students_feedback | feedback |
| C311 | `controllers/feedbackController.js:301` | students_feedback | feedback |
| C312 | `controllers/feedbackController.js:319` | mastertrainers | master_trainer |
| C313 | `controllers/feedbackController.js:343` | students_feedback | feedback |
| C314 | `controllers/feedbackController.js:350` | students | student |
| C315 | `controllers/feedbackController.js:418` | students_feedback | feedback |
| C316 | `controllers/feedbackController.js:432` | trainers | trainer, allocation |
| C317 | `controllers/feedbackController.js:444` | students_feedback | feedback |
| C318 | `controllers/freelancingController.js:6` | students | student |
| C319 | `controllers/freelancingController.js:18` | students_freelancing_profiles | freelance_profile |
| C320 | `controllers/freelancingController.js:30` | students | student |
| C321 | `controllers/freelancingController.js:36` | students_freelancing_profiles | freelance_profile |
| C322 | `controllers/freelancingController.js:51` | students_freelancing_profiles | freelance_profile |
| C323 | `controllers/freelancingController.js:74` | students_freelancing_profiles | freelance_profile |
| C324 | `controllers/generateCertificate.js:13` | centers_dates | center_dates |
| C325 | `controllers/holidaysController.js:8` | holidays | holiday |
| C326 | `controllers/holidaysController.js:31` | holidays | holiday |
| C327 | `controllers/holidaysController.js:79` | holidays | holiday |
| C328 | `controllers/learningResourceController.js:19` | trainers | trainer, allocation |
| C329 | `controllers/learningResourceController.js:29` | trainers_center_allocation | trainer, allocation |
| C330 | `controllers/learningResourceController.js:83` | trainers | trainer, allocation |
| C331 | `controllers/learningResourceController.js:97` | mastertrainers | master_trainer |
| C332 | `controllers/learningResourceController.js:109` | learning_resources | resource |
| C333 | `controllers/learningResourceController.js:142` | learning_resources | resource |
| C334 | `controllers/learningResourceController.js:173` | learning_resources | resource |
| C335 | `controllers/learningResourceController.js:203` | learning_resources | resource |
| C336 | `controllers/lectureRecordingController.js:19` | trainers | trainer, allocation |
| C337 | `controllers/lectureRecordingController.js:29` | trainers_center_allocation | trainer, allocation |
| C338 | `controllers/lectureRecordingController.js:80` | trainers | trainer, allocation |
| C339 | `controllers/lectureRecordingController.js:94` | mastertrainers | master_trainer |
| C340 | `controllers/lectureRecordingController.js:106` | lecture_recordings | recording |
| C341 | `controllers/lectureRecordingController.js:139` | lecture_recordings | recording |
| C342 | `controllers/lectureRecordingController.js:170` | lecture_recordings | recording |
| C343 | `controllers/lectureRecordingController.js:193` | lecture_recordings | recording |
| C344 | `controllers/masterTrainersController.js:26` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C345 | `controllers/masterTrainersController.js:195` | mastertrainers | master_trainer |
| C346 | `controllers/notificationController.js:29` | notifications | excluded: in-app notification feed |
| C347 | `controllers/notificationController.js:56` | notifications | excluded: in-app notification feed |
| C348 | `controllers/onlineClassReportController.js:38` | mastertrainers | master_trainer |
| C349 | `controllers/onlineClassReportController.js:72` | mastertrainers | master_trainer |
| C350 | `controllers/onlineClassReportController.js:108` | online_class_reports | online_class_report |
| C351 | `controllers/onlineClassReportController.js:204` | online_class_reports | online_class_report |
| C352 | `controllers/onlineClassReportController.js:267` | online_class_reports | online_class_report |
| C353 | `controllers/onlineClassReportController.js:365` | online_class_reports | online_class_report |
| C354 | `controllers/onlineClassReportController.js:410` | online_class_reports | online_class_report |
| C355 | `controllers/onlineClassReportController.js:426` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C356 | `controllers/profileController.js:182` | trainers | trainer, allocation |
| C357 | `controllers/profileController.js:192` | trainers_center_allocation | trainer, allocation |
| C358 | `controllers/profileController.js:274` | training_batches | batch |
| C359 | `controllers/quizController.js:46` | trainers | trainer, allocation |
| C360 | `controllers/quizController.js:86` | trainers_center_allocation | trainer, allocation |
| C361 | `controllers/quizController.js:122` | student_quiz | quiz |
| C362 | `controllers/quizController.js:165` | students | student |
| C363 | `controllers/quizController.js:178` | student_quiz | quiz |
| C364 | `controllers/quizController.js:185` | student_quiz_attempts | quiz_attempt |
| C365 | `controllers/quizController.js:223` | student_quiz_questions | excluded: quiz answer keys (exam integrity) |
| C366 | `controllers/quizController.js:302` | student_quiz_attempts | quiz_attempt |
| C367 | `controllers/quizController.js:320` | student_quiz | quiz |
| C368 | `controllers/quizController.js:341` | student_quiz_questions | excluded: quiz answer keys (exam integrity) |
| C369 | `controllers/quizController.js:438` | student_quiz_attempts | quiz_attempt |
| C370 | `controllers/quizController.js:479` | trainers | trainer, allocation |
| C371 | `controllers/quizController.js:488` | student_quiz | quiz |
| C372 | `controllers/quizController.js:512` | student_quiz_questions | excluded: quiz answer keys (exam integrity) |
| C373 | `controllers/quizController.js:542` | students | student |
| C374 | `controllers/quizController.js:563` | trainers_center_allocation | trainer, allocation |
| C375 | `controllers/quizController.js:581` | student_quiz | quiz |
| C376 | `controllers/quizController.js:592` | student_quiz_questions | excluded: quiz answer keys (exam integrity) |
| C377 | `controllers/quizController.js:601` | student_quiz_attempts | quiz_attempt |
| C378 | `controllers/quizController.js:659` | student_quiz | quiz |
| C379 | `controllers/quizController.js:723` | student_quiz | quiz |
| C380 | `controllers/quizController.js:774` | student_quiz | quiz |
| C381 | `controllers/quizController.js:784` | student_quiz_attempts | quiz_attempt |
| C382 | `controllers/quizController.js:792` | students | student |
| C383 | `controllers/studentController.js:65` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C384 | `controllers/studentController.js:87` | students | student |
| C385 | `controllers/studentController.js:287` | attendance | attendance |
| C386 | `controllers/studentController.js:565` | trainers | trainer, allocation |
| C387 | `controllers/studentController.js:574` | trainers_center_allocation | trainer, allocation |
| C388 | `controllers/studentController.js:603` | mastertrainers | master_trainer |
| C389 | `controllers/studentController.js:632` | centerusers | excluded: staff accounts / authentication |
| C390 | `controllers/studentController.js:733` | training_batches | batch |
| C391 | `controllers/studentController.js:889` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C392 | `controllers/studentController.js:898` | training_batches | batch |
| C393 | `controllers/studentController.js:998` | students | student |
| C394 | `controllers/studentController.js:1101` | students | student |
| C395 | `controllers/studentController.js:1161` | students | student |
| C396 | `controllers/studentController.js:1238` | students | student |
| C397 | `controllers/studentController.js:1311` | students | student |
| C398 | `controllers/studentLeaveController.js:27` | students_leaves | leave |
| C399 | `controllers/studentLeaveController.js:58` | students | student |
| C400 | `controllers/studentLeaveController.js:121` | students_leaves | leave |
| C401 | `controllers/studentLeaveController.js:131` | students_leaves | leave |
| C402 | `controllers/studentLeaveController.js:218` | students | student |
| C403 | `controllers/studentLeaveController.js:254` | students | student |
| C404 | `controllers/studentLeaveController.js:264` | students_leaves | leave |
| C405 | `controllers/studentLeaveController.js:316` | students_leaves | leave |
| C406 | `controllers/studentLeaveController.js:337` | students | student |
| C407 | `controllers/studentLeaveController.js:344` | students_leaves | leave |
| C408 | `controllers/studentLeaveController.js:367` | students_leaves | leave |
| C409 | `controllers/studentLeaveController.js:374` | training_batches | batch |
| C410 | `controllers/studentLeaveController.js:380` | courses | course |
| C411 | `controllers/studentLeaveController.js:386` | centers | center |
| C412 | `controllers/studentLeaveController.js:400` | students_leaves | leave |
| C413 | `controllers/studentLeaveController.js:421` | students_leaves | leave |
| C414 | `controllers/studentPurgeController.js:117` | students | student |
| C415 | `controllers/studentPurgeController.js:129` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C416 | `controllers/studentsDocsController.js:12` | students_docs | document |
| C417 | `controllers/studentsDocsController.js:23` | students | student |
| C418 | `controllers/studentsDocsController.js:27` | students_docs | document |
| C419 | `controllers/studentsDocsController.js:45` | students | student |
| C420 | `controllers/studentsDocsController.js:57` | students_docs | document |
| C421 | `controllers/studentsDocsController.js:89` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C422 | `controllers/studentsDocsController.js:96` | students_docs | document |
| C423 | `controllers/studentsDocsController.js:114` | students_docs | document |
| C424 | `controllers/ticketController.js:39` | trainers_center_allocation | trainer, allocation |
| C425 | `controllers/ticketController.js:46` | students | student |
| C426 | `controllers/ticketController.js:133` | students | student |
| C427 | `controllers/ticketController.js:138` | trainers | trainer, allocation |
| C428 | `controllers/ticketController.js:143` | mastertrainers | master_trainer |
| C429 | `controllers/ticketController.js:149` | tickets | ticket |
| C430 | `controllers/ticketController.js:180` | students | student |
| C431 | `controllers/ticketController.js:208` | tickets | ticket |
| C432 | `controllers/ticketController.js:224` | ticket_replies | excluded: private ticket conversations |
| C433 | `controllers/ticketController.js:235` | students | student |
| C434 | `controllers/ticketController.js:243` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C435 | `controllers/ticketController.js:276` | tickets | ticket |
| C436 | `controllers/ticketController.js:307` | tickets | ticket |
| C437 | `controllers/ticketController.js:335` | tickets | ticket |
| C438 | `controllers/ticketController.js:361` | ticket_replies | excluded: private ticket conversations |
| C439 | `controllers/ticketController.js:415` | ticket_replies | excluded: private ticket conversations |
| C440 | `controllers/topicController.js:4` | topics | topic, topic_report |
| C441 | `controllers/topicController.js:9` | topics | topic, topic_report |
| C442 | `controllers/topicController.js:20` | topics | topic, topic_report |
| C443 | `controllers/topicController.js:27` | topics | topic, topic_report |
| C444 | `controllers/trainerAttendanceController.js:42` | trainer_attendance | trainer_attendance |
| C445 | `controllers/trainerAttendanceController.js:95` | trainers_center_allocation | trainer, allocation |
| C446 | `controllers/trainerAttendanceController.js:132` | trainers_center_allocation | trainer, allocation |
| C447 | `controllers/trainerAttendanceController.js:253` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C448 | `controllers/trainerAttendanceController.js:280` | trainers | trainer, allocation |
| C449 | `controllers/trainerAttendanceController.js:285` | trainers | trainer, allocation |
| C450 | `controllers/trainerAttendanceController.js:332` | trainer_attendance | trainer_attendance |
| C451 | `controllers/trainerAttendanceController.js:455` | trainer_attendance | trainer_attendance |
| C452 | `controllers/trainerAttendanceController.js:460` | trainer_attendance | trainer_attendance |
| C453 | `controllers/trainerAttendanceController.js:552` | trainers | trainer, allocation |
| C454 | `controllers/trainerAttendanceController.js:576` | trainers_center_allocation | trainer, allocation |
| C455 | `controllers/trainerAttendanceController.js:601` | trainers_center_allocation | trainer, allocation |
| C456 | `controllers/trainerAttendanceController.js:622` | trainers | trainer, allocation |
| C457 | `controllers/trainerAttendanceController.js:628` | centers | center |
| C458 | `controllers/trainerAttendanceController.js:629` | courses | course |
| C459 | `controllers/trainerAttendanceController.js:631` | holidays | holiday |
| C460 | `controllers/trainerAttendanceController.js:632` | trainer_attendance | trainer_attendance |
| C461 | `controllers/trainerAttendanceController.js:635` | trainer_attendance_notes | excluded: internal HR notes |
| C462 | `controllers/trainerAttendanceController.js:692` | trainers | trainer, allocation |
| C463 | `controllers/trainerAttendanceController.js:710` | trainer_attendance | trainer_attendance |
| C464 | `controllers/trainerAttendanceController.js:715` | trainer_attendance | trainer_attendance |
| C465 | `controllers/trainerAttendanceController.js:839` | trainer_attendance | trainer_attendance |
| C466 | `controllers/trainerAttendanceController.js:862` | trainer_attendance | trainer_attendance |
| C467 | `controllers/trainerAttendanceController.js:889` | trainer_attendance | trainer_attendance |
| C468 | `controllers/trainerAttendanceController.js:910` | trainer_attendance | trainer_attendance |
| C469 | `controllers/trainerAttendanceController.js:951` | trainer_attendance | trainer_attendance |
| C470 | `controllers/trainerLeaveController.js:46` | training_batches | batch |
| C471 | `controllers/trainerLeaveController.js:47` | centers | center |
| C472 | `controllers/trainerLeaveController.js:48` | courses | course |
| C473 | `controllers/trainerLeaveController.js:49` | trainers | trainer, allocation |
| C474 | `controllers/trainerLeaveController.js:73` | trainer_leaves | trainer_leave |
| C475 | `controllers/trainerLeaveController.js:134` | trainers | trainer, allocation |
| C476 | `controllers/trainerLeaveController.js:139` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C477 | `controllers/trainerLeaveController.js:152` | trainers_center_allocation | trainer, allocation |
| C478 | `controllers/trainerLeaveController.js:171` | trainer_leaves | trainer_leave |
| C479 | `controllers/trainerLeaveController.js:197` | mastertrainers | master_trainer |
| C480 | `controllers/trainerLeaveController.js:211` | trainer_leaves | trainer_leave |
| C481 | `controllers/trainerLeaveController.js:224` | trainer_leaves | trainer_leave |
| C482 | `controllers/trainerLeaveController.js:239` | trainers | trainer, allocation |
| C483 | `controllers/trainerLeaveController.js:244` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C484 | `controllers/trainerLeaveController.js:259` | trainer_leaves | trainer_leave |
| C485 | `controllers/trainerLeaveController.js:279` | trainer_leaves | trainer_leave |
| C486 | `controllers/trainerLeaveController.js:286` | training_batches | batch |
| C487 | `controllers/trainerLeaveController.js:292` | centers | center |
| C488 | `controllers/trainerLeaveController.js:298` | courses | course |
| C489 | `controllers/trainerLeaveController.js:312` | trainer_leaves | trainer_leave |
| C490 | `controllers/trainerLeaveController.js:333` | trainer_leaves | trainer_leave |
| C491 | `controllers/trainerLeaveController.js:391` | trainer_leaves | trainer_leave |
| C492 | `controllers/trainersCenterAllocationController.js:10` | trainers_center_allocation | trainer, allocation |
| C493 | `controllers/trainersCenterAllocationController.js:26` | trainers_center_allocation | trainer, allocation |
| C494 | `controllers/trainersCenterAllocationController.js:55` | trainers | trainer, allocation |
| C495 | `controllers/trainersCenterAllocationController.js:56` | training_batches | batch |
| C496 | `controllers/trainersCenterAllocationController.js:57` | centers | center |
| C497 | `controllers/trainersCenterAllocationController.js:58` | courses | course |
| C498 | `controllers/trainersCenterAllocationController.js:80` | trainers_center_allocation | trainer, allocation |
| C499 | `controllers/trainersCenterAllocationController.js:121` | trainers_center_allocation | trainer, allocation |
| C500 | `controllers/trainersCenterAllocationController.js:133` | trainers | trainer, allocation |
| C501 | `controllers/trainersCenterAllocationController.js:142` | training_batches | batch |
| C502 | `controllers/trainersCenterAllocationController.js:151` | centers | center |
| C503 | `controllers/trainersCenterAllocationController.js:168` | trainers_center_allocation | trainer, allocation |
| C504 | `controllers/trainersCenterAllocationController.js:195` | trainers_center_allocation | trainer, allocation |
| C505 | `controllers/trainersController.js:35` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C506 | `controllers/trainersController.js:96` | students | student |
| C507 | `controllers/trainersController.js:108` | trainers_center_allocation | trainer, allocation |
| C508 | `controllers/trainersController.js:136` | trainers | trainer, allocation |
| C509 | `controllers/trainersController.js:142` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C510 | `controllers/trainersController.js:176` | mastertrainers | master_trainer |
| C511 | `controllers/trainersController.js:182` | centerusers | excluded: staff accounts / authentication |
| C512 | `controllers/trainersController.js:190` | trainers_center_allocation | trainer, allocation |
| C513 | `controllers/trainersController.js:416` | trainers | trainer, allocation |
| C514 | `controllers/trainerTopicReportController.js:12` | trainer_topic_reports | topic_report |
| C515 | `controllers/trainerTopicReportController.js:21` | trainer_topic_reports | topic_report |
| C516 | `controllers/trainerTopicReportController.js:40` | trainer_topic_reports | topic_report |
| C517 | `controllers/trainerTopicReportController.js:51` | trainer_topic_reports | topic_report |
| C518 | `controllers/trainerTopicReportController.js:65` | trainer_topic_reports | topic_report |
| C519 | `controllers/trainingBatchController.js:43` | training_batches | batch |
| C520 | `controllers/trainingBatchController.js:78` | trainers | trainer, allocation |
| C521 | `controllers/trainingBatchController.js:86` | trainers_center_allocation | trainer, allocation |
| C522 | `controllers/trainingBatchController.js:100` | training_batches | batch |
| C523 | `controllers/trainingBatchController.js:131` | training_batches | batch |
| C524 | `controllers/trainingBatchController.js:160` | training_batches | batch |
| C525 | `controllers/userController.js:23` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C526 | `controllers/userController.js:92` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C527 | `controllers/userController.js:130` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C528 | `controllers/weeklyEvaluationController.js:83` | mastertrainers | master_trainer |
| C529 | `controllers/weeklyEvaluationController.js:96` | centers | center |
| C530 | `controllers/weeklyEvaluationController.js:97` | courses | course |
| C531 | `controllers/weeklyEvaluationController.js:98` | training_batches | batch |
| C532 | `controllers/weeklyEvaluationController.js:127` | trainers | trainer, allocation |
| C533 | `controllers/weeklyEvaluationController.js:176` | mastertrainers | master_trainer |
| C534 | `controllers/weeklyEvaluationController.js:226` | weekly_evaluations | weekly_evaluation |
| C535 | `controllers/weeklyEvaluationController.js:285` | trainers | trainer, allocation |
| C536 | `controllers/weeklyEvaluationController.js:330` | weekly_evaluations | weekly_evaluation |
| C537 | `controllers/weeklyEvaluationController.js:435` | trainers | trainer, allocation |
| C538 | `controllers/weeklyEvaluationController.js:465` | weekly_evaluations | weekly_evaluation |
| C539 | `controllers/weeklyEvaluationController.js:612` | weekly_evaluations | weekly_evaluation |
| C540 | `controllers/weeklyEvaluationController.js:648` | weekly_evaluations | weekly_evaluation |
| C541 | `controllers/weeklyEvaluationController.js:707` | trainers_center_allocation | trainer, allocation |
| C542 | `controllers/weeklyEvaluationController.js:741` | trainers | trainer, allocation |
| C543 | `controllers/weeklyEvaluationController.js:748` | weekly_evaluations | weekly_evaluation |
| C544 | `controllers/weeklyEvaluationController.js:753` | mastertrainers | master_trainer |
| C545 | `controllers/weeklyEvaluationController.js:840` | weekly_evaluations | weekly_evaluation |
| C546 | `controllers/weeklyEvaluationController.js:861` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C547 | `controllers/weeklyEvaluationController.js:932` | trainers_center_allocation | trainer, allocation |
| C548 | `controllers/weeklyEvaluationController.js:968` | weekly_evaluations | weekly_evaluation |
| C549 | `middleware/auth.js:9` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C550 | `middleware/authMiddleware.js:101` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C551 | `middleware/centersValidation.js:10` | centers | center |
| C552 | `middleware/centersValidation.js:25` | centers | center |
| C553 | `middleware/trainingBatchValidation.js:10` | training_batches | batch |
| C554 | `utils/assignmentAccess.js:33` | trainers | trainer, allocation |
| C555 | `utils/assignmentAccess.js:38` | trainers_center_allocation | trainer, allocation |
| C556 | `utils/assignmentAccess.js:46` | students | student |
| C557 | `utils/attendanceCalculator.js:185` | attendance | attendance |
| C558 | `utils/attendanceCalculator.js:235` | attendance | attendance |
| C559 | `utils/brevoContactCleanup.js:64` | brevo_contacts | excluded: email provider sync |
| C560 | `utils/brevoContactCleanup.js:105` | brevo_contacts | excluded: email provider sync |
| C561 | `utils/classSchedule.js:178` | class_schedules | schedule |
| C562 | `utils/classSchedule.js:196` | holidays | holiday |
| C563 | `utils/contactUniqueness.js:116` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C564 | `utils/contactUniqueness.js:125` | students | student |
| C565 | `utils/contactUniqueness.js:139` | candidates | candidate |
| C566 | `utils/contactUniqueness.js:151` | students | student |
| C567 | `utils/contactUniqueness.js:164` | candidates | candidate |
| C568 | `utils/emailCampaignDispatcher.js:231` | email_campaign_recipients | excluded: email delivery internals |
| C569 | `utils/emailCampaignDispatcher.js:338` | email_campaign_recipients | excluded: email delivery internals |
| C570 | `utils/emailCampaignDispatcher.js:412` | email_campaigns | excluded: email delivery internals |
| C571 | `utils/emailOutbox.js:176` | email_outbox | excluded: email delivery internals |
| C572 | `utils/emailOutbox.js:266` | email_outbox | excluded: email delivery internals |
| C573 | `utils/emailQuota.js:70` | email_send_quota | excluded: email delivery internals |
| C574 | `utils/evaluationMetrics.js:50` | trainers_center_allocation | trainer, allocation |
| C575 | `utils/evaluationMetrics.js:90` | daily_lecture_reports | lecture_report |
| C576 | `utils/evaluationMetrics.js:117` | assignments | assignment, submission |
| C577 | `utils/evaluationMetrics.js:131` | student_quiz | quiz |
| C578 | `utils/evaluationMetrics.js:153` | students | student |
| C579 | `utils/evaluationMetrics.js:167` | students | student |
| C580 | `utils/evaluationMetrics.js:259` | attendance | attendance |
| C581 | `utils/evaluationMetrics.js:320` | students_leaves | leave |
| C582 | `utils/evaluationScope.js:28` | centers | center |
| C583 | `utils/evaluationScope.js:76` | trainers_center_allocation | trainer, allocation |
| C584 | `utils/evaluationScope.js:99` | trainers_center_allocation | trainer, allocation |
| C585 | `utils/evaluationScope.js:135` | centers_dates | center_dates |
| C586 | `utils/notify.js:85` | students | student |
| C587 | `utils/notify.js:106` | students | student |
| C588 | `utils/notify.js:118` | trainers | trainer, allocation |
| C589 | `utils/notify.js:146` | trainers_center_allocation | trainer, allocation |
| C590 | `utils/notify.js:149` | trainers | trainer, allocation |
| C591 | `utils/notify.js:162` | mastertrainers | master_trainer |
| C592 | `utils/notify.js:175` | mastertrainers | master_trainer |
| C593 | `utils/notify.js:188` | students | student |
| C594 | `utils/notify.js:201` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| C595 | `utils/onlineReportScope.js:35` | trainers_center_allocation | trainer, allocation |
| C596 | `utils/onlineReportScope.js:44` | centers | center |
| C597 | `utils/onlineReportScope.js:68` | courses | course |
| C598 | `utils/refreshTokens.js:30` | <auth-tokens> | excluded: login refresh tokens (authentication secret) |
| C599 | `utils/studentProfilePhoto.js:123` | students_docs | document |
| C600 | `utils/trainerAttendanceReminder.js:51` | training_batches | batch |
| C601 | `utils/trainerAttendanceReminder.js:73` | trainers_center_allocation | trainer, allocation |
| C602 | `utils/trainerAttendanceReminder.js:115` | trainer_attendance | trainer_attendance |
| C603 | `utils/trainerAttendanceReminder.js:124` | daily_lecture_reports | lecture_report |
| C604 | `utils/trainerAttendanceReminder.js:135` | notifications | excluded: in-app notification feed |
| C605 | `utils/trainerAttendanceReminder.js:189` | trainers | trainer, allocation |
| C606 | `utils/trainerScope.js:64` | trainers | trainer, allocation |
| C607 | `utils/trainerScope.js:72` | trainers_center_allocation | trainer, allocation |
| C608 | `utils/visitScope.js:38` | trainers_center_allocation | trainer, allocation |
| C609 | `utils/visitScope.js:48` | centers | center |
| C610 | `utils/visitScope.js:53` | centers_dates | center_dates |
| D001 | `scripts/backfill-profile-photos.js:55` | students | student |
| D002 | `scripts/backfill-profile-photos.js:70` | user | student, trainer, allocation, trainer_leave, trainer_attendance, master_trainer, weekly_evaluation, user |
| D003 | `scripts/backfill-student-details.js:107` | students | student |
| D004 | `scripts/backfill-student-details.js:130` | candidates | candidate |
| D005 | `scripts/clean-duplicate-allocations.js:43` | trainers_center_allocation | trainer, allocation |
| D006 | `scripts/clean-duplicate-assignments.js:48` | assignments | assignment, submission |
| D007 | `scripts/clean-duplicate-assignments.js:84` | assignment_submissions | submission |
