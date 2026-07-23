cmake_minimum_required(VERSION 3.8)
project(agv_msgs)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(nav_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

# Message definitions
set(msg_files
  "msg/VehicleState.msg"
  "msg/FleetState.msg"
  "msg/EmergencyStop.msg"
  "msg/SafetyStatus.msg"
  "msg/BumperEvent.msg"
  "msg/TrafficZone.msg"
  "msg/TrafficZoneArray.msg"
  "msg/TaskStatusUpdate.msg"
  "msg/SystemMetrics.msg"
  "msg/TaskSpec.msg"
  "msg/AGVStatus.msg"
  "msg/TaskAssignment.msg"
)

# Service definitions
set(srv_files
  "srv/DispatchTask.srv"
  "srv/CancelTask.srv"
  "srv/QueryTask.srv"
  "srv/QueryAGV.srv"
  "srv/QueryFleet.srv"
  "srv/PlanPath.srv"
  "srv/GetMap.srv"
  "srv/UpdateMap.srv"
  "srv/ReserveZone.srv"
  "srv/ReleaseZone.srv"
  "srv/DetectDeadlock.srv"
  "srv/ResolveDeadlock.srv"
  "srv/SetGoal.srv"
  "srv/PauseResume.srv"
  "srv/ManualEstop.srv"
  "srv/ClearEstop.srv"
  "srv/RecoverLocalization.srv"
  "srv/SchedulerConfig.srv"
  "srv/SafetyParams.srv"
  "srv/SetSpeedLimit.srv"
)

# Action definitions
set(action_files
  "action/ExecuteTask.action"
  "action/Navigate.action"
  "action/Charge.action"
  "action/Dock.action"
  "action/Patrol.action"
)

rosidl_generate_interfaces(${PROJECT_NAME}
  ${msg_files}
  ${srv_files}
  ${action_files}
  DEPENDENCIES builtin_interfaces geometry_msgs nav_msgs sensor_msgs std_msgs
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
