# Named selected-object Follow

Connect a camera, choose **Select Object**, and use MobileSAM positive/negative
points or a box to isolate the object. Enter a name and choose **Add object & track**.
Keep the object still while selecting: the frozen appearance must still match the
live scene. Once the status is TRACKING, connect Finch and explicitly press
**Follow selected target**. Start at a low forward speed in a clear area.

This path does not require YOLO to recognize the object. MobileSAM creates the
initial mask; a fixed, mask-weighted appearance template searches subsequent
camera frames locally at multiple scales. It tracks one object at a time. The
existing YOLO **Lock target** path remains available separately.

Up to ten names appear in My selected objects, with the active tracking state.
Names survive project save/export/import. Images and templates are not saved:
after reload, select the object again and reuse its saved name. A name does not
train a detector class or become a general class-based rule condition.

Coordinates use the shared camera mirror transform. Existing selected-target
Follow handles steering, area-based distance and STOP. Only new camera frames
can refresh tracking; uncertain matches do not renew its watchdog. Target loss
requires a new selection. Resetting the project or switching robots clears names.

Appearance tracking is experimental. Large rotations, fast motion, occlusion,
lighting changes and similar nearby objects can cause loss or incorrect matching.
It is not persistent object recognition, obstacle avoidance or metric distance
measurement. The camera needs to move with Finch for closed-loop following.

Validation: unit tests cover translation, mirror/area, Follow steering, ambiguity,
loss, duplicate samples, reset and name import validation. The browser fixture
exercises real MobileSAM selection and live appearance updates with YOLO unloaded.
A physical cup-follow test remains necessary before claiming hardware acceptance.
