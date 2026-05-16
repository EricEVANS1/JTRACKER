# JTracker

A modern full-stack job application tracking platform designed to help job seekers manage applications, monitor recruitment pipelines, analyze progress, and organize communication with recruiters.

## Overview

JTracker was built as a portfolio-level software engineering project focused on solving a real-world problem: managing large volumes of job applications efficiently while gaining visibility into the entire recruitment lifecycle.

The platform combines application management, recruiter tracking, Gmail integration, Kanban workflow management, analytics, reminders, and timeline tracking into a single unified dashboard.

---

# Features

## Application Tracking

* Create and manage job applications
* Track application status throughout the recruitment lifecycle
* Store:

  * role title
  * company
  * application links
  * salary expectations
  * notes
  * job type
  * location
  * source of application
* Archive applications
* Track status history automatically

## Recruitment Pipeline (Kanban Board)

Interactive drag-and-drop Kanban system for tracking:

* Wishlist
* Applied
* Confirmation Received
* Assessment
* Interview
* Final Interview
* Offer
* Rejected

Built using drag-and-drop interactions for a modern workflow experience.

## Gmail Intelligence System

Integrated Gmail synchronization system capable of:

* Detecting recruitment emails
* Matching emails to applications
* Identifying recruitment stages automatically
* Creating email intelligence events
* Tracking Gmail sync sessions
* Viewing synced recruitment communication

## Recruiter Management

Track recruiter relationships and communication.

Features include:

* Recruiter profiles
* Recruiter notes
* Interaction history
* Linked recruiter applications
* Linked company information

## Follow-Up Management

* Create follow-up reminders
* Track pending recruiter responses
* Monitor inactive applications
* Organize communication deadlines

## Analytics Dashboard

Visual analytics and statistics including:

* Total applications
* Interview rates
* Offer rates
* Rejection tracking
* Application sources
* Pipeline distribution
* Recent activity

## Timeline & Events System

Every important action can generate events such as:

* Status changes
* Interview progression
* Offer received
* Rejection received
* Manual updates
* Gmail detected changes

## Authentication System

Secure authentication with:

* User accounts
* Session management
* Protected routes
* Supabase authentication
* Role-aware architecture foundations

---

# Tech Stack

## Frontend

* React
* TypeScript
* Vite
* Tailwind CSS
* React Router
* Lucide React
* DnD Kit
* Recharts

## Backend & Database

* Supabase
* PostgreSQL
* Row Level Security (RLS)
* Supabase Auth
* SQL Triggers & Functions

## Features & Integrations

* Gmail API Integration
* Real-time capable architecture
* Analytics processing
* Event tracking system

## Development Tools

* Git
* GitHub
* Visual Studio Code
* npm

---

# Database Highlights

The system uses a relational PostgreSQL database architecture with:

* applications
* companies
* recruiters
* recruiter_interactions
* email_events
* reminders
* application_events
* tags
* interview_notes
* gmail_connections
* gmail_sync_sessions

Advanced functionality includes:

* automatic status tracking
* timestamp triggers
* relational linking
* optimized indexes
* secure Row Level Security policies

---

# Key Engineering Concepts Demonstrated

This project demonstrates:

* Full-stack application development
* REST-style data management
* Database design
* Authentication systems
* State management
* Complex TypeScript typing
* Frontend architecture
* Backend integration
* Production builds
* Error handling
* Responsive UI design
* Drag-and-drop interfaces
* Data normalization
* SQL schema design
* Secure database access with RLS

---

# Project Goals

The project was designed to:

* Improve organization during large-scale job searches
* Centralize recruitment communication
* Provide visibility into recruitment progress
* Simulate production-level SaaS architecture
* Demonstrate junior-to-mid level software engineering capability

---

# Current Status

JTracker is actively being improved and expanded.

Recent improvements include:

* TypeScript build stabilization
* Gmail event normalization
* Kanban workflow improvements
* Supabase relationship handling fixes
* Production build optimization
* Improved application lifecycle tracking

---

# Future Improvements

Planned improvements include:

* AI-assisted email matching
* Enhanced analytics
* CV version performance tracking
* Multi-provider email support
* Real-time notifications
* Mobile optimization
* Advanced recruiter analytics
* Team collaboration support
* Calendar integration
* Browser notifications

---

# Installation

## Clone Repository

```bash
git clone https://github.com/EricEVANS1/JTRACKER.git
```

## Navigate Into Project

```bash
cd JTRACKER
```

## Install Dependencies

```bash
npm install
```

## Start Development Server

```bash
npm run dev
```

## Production Build

```bash
npm run build
```


# Deployment

The application is configured for deployment using:

* Vercel
* Netlify
* GitHub-based workflows

Production builds are generated using:

```bash
npm run build
```

---

# Screens & Modules

Main modules include:

* Dashboard
* Applications
* Kanban Pipeline
* Gmail Sync
* Email Intelligence Center
* Recruiters
* Notifications
* Follow Ups
* Archived Applications
* Analytics
* CV Management

---

# Author

Eric Evans

Computer Engineering Graduate

Focused on:

* Software Engineering
* Full-Stack Development
* Backend Systems
* SaaS Architecture
* Real-World Problem Solving

GitHub:

[https://github.com/EricEVANS1](https://github.com/EricEVANS1)

---

# License

This project is intended for educational, portfolio, and demonstration purposes.
