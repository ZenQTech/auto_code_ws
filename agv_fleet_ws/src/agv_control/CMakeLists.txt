cmake_minimum_required(VERSION 3.8)
project(agv_control)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
endif()

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(agv_core REQUIRED)
find_package(agv_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(nav_msgs REQUIRED)

# Motion controller node
add_executable(motion_controller_node
  src/motion_controller_node.cpp
  src/cmd_mux.cpp
  src/odometry_publisher.cpp
)

target_include_directories(motion_controller_node PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(motion_controller_node
  agv_core
  ${rclcpp_LIBRARIES}
)

ament_target_dependencies(motion_controller_node
  rclcpp agv_core agv_msgs geometry_msgs nav_msgs
)

install(TARGETS motion_controller_node
  DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY include/
  DESTINATION include
)

ament_package()
