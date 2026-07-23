cmake_minimum_required(VERSION 3.8)
project(agv_core)

# C++17 for ROS2 Humble
if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
endif()

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(agv_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(nav_msgs REQUIRED)

# Core library
add_library(agv_core SHARED
  src/types.cpp
  src/utils.cpp
  src/lifecycle/lifecycle_manager.cpp
)

target_include_directories(agv_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)

target_link_libraries(agv_core
  ${rclcpp_LIBRARIES}
)

ament_target_dependencies(agv_core
  rclcpp
  agv_msgs
  geometry_msgs
  nav_msgs
)

install(TARGETS agv_core
  EXPORT agv_core_export
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)

install(DIRECTORY include/
  DESTINATION include
)

ament_export_targets(agv_core_export HAS_LIBRARY_TARGET)
ament_export_dependencies(rclcpp agv_msgs geometry_msgs nav_msgs)
ament_package()
